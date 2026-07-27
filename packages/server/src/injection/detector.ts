import type { NormalizedProposal } from '@daifugo/core';

import { normalizeDetectionInput, type Layer0Flags } from './normalize.js';
import { matchPatterns, type Layer1Hits } from './patterns.js';

export type LlmVerdict = 'clean' | 'suspicious' | 'injection';

export interface Layer2Flags {
  hasCodeFence: boolean;
  hasUrl: boolean;
  hasBase64Like: boolean;
  langSwitch: boolean;
  systemVocabDensity: boolean;
  trailingDirective: boolean;
}

export interface LlmSuccessResult {
  verdict: LlmVerdict;
  reason: string;
  evidence: string | null;
  evidenceVerified: boolean;
  model: string;
  latencyMs: number;
}

export interface LlmErrorResult {
  verdict: 'error';
  reason: 'judge_unavailable';
  evidence: null;
  evidenceVerified: false;
  model: null;
  latencyMs: null;
}

export type LlmResult = LlmSuccessResult | LlmErrorResult;

export interface InjectionJudge {
  judge(input: {
    name: string;
    body: string;
    inputText: string;
    normalizedText: string;
    layer1: Layer1Hits;
    layer2: Layer2Flags;
  }): Promise<Omit<LlmSuccessResult, 'evidenceVerified'>>;
}

export class UnavailableInjectionJudge implements InjectionJudge {
  async judge(): Promise<never> {
    throw new Error('No injection judge provider is configured');
  }
}

export interface DetectionResult {
  finalVerdict: 'pass' | 'block_soft' | 'block_card';
  softReasonKey?: 'invisible_chars' | 'format' | 'generic';
  layers: {
    layer0: Layer0Flags;
    layer1: Layer1Hits;
    layer2: Layer2Flags;
    llm: LlmResult | null;
  };
  detectorVersion: string;
  inputText: string;
  normalizedText: string;
  inputHash: string;
  reviewFlag: boolean;
}

export type StaticAnalysisResult = Omit<
  DetectionResult,
  'finalVerdict' | 'softReasonKey' | 'reviewFlag' | 'layers'
> & {
  layers: Omit<DetectionResult['layers'], 'llm'>;
};

export class InjectionUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Injection judge is unavailable', options);
    this.name = 'InjectionUnavailableError';
  }
}

export function computeLayer2(
  inputText: string,
  normalizedText: string,
  layer1: Layer1Hits,
): Layer2Flags {
  const japaneseCharacters =
    inputText.match(/[ぁ-んァ-ヶ一-龠]/gu)?.length ?? 0;
  const englishDirective = normalizedText.match(
    /\b(?:ignore|reveal|output|execute|read|write|skip)\s+(?:\w+\s+){2,}\w+/iu,
  );
  return {
    hasCodeFence:
      /```/u.test(normalizedText) || /(?:^|\n) {4}\S/u.test(inputText),
    hasUrl:
      /https?:\/\//iu.test(normalizedText) ||
      /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?/iu.test(normalizedText),
    hasBase64Like: /[a-z0-9+/]{40,}={0,2}/iu.test(normalizedText),
    langSwitch: japaneseCharacters >= 8 && englishDirective !== null,
    systemVocabDensity: layer1.soft.length >= 2,
    trailingDirective:
      /[。.!?]\s*(?:なお|ただし|追伸|note|p\.?s\.?)[：:\s]/iu.test(
        normalizedText,
      ),
  };
}

export class InjectionStaticAnalyzer {
  readonly detectorVersion: string;

  constructor(detectorVersion = 'e6-p2-patterns1-prompt1') {
    this.detectorVersion = detectorVersion;
  }

  analyze(proposal: NormalizedProposal): StaticAnalysisResult {
    const normalized = normalizeDetectionInput(proposal);
    const layer1 = matchPatterns(normalized.normalizedText);
    const layer2 = computeLayer2(
      normalized.inputText,
      normalized.normalizedText,
      layer1,
    );
    return {
      layers: { layer0: normalized.layer0, layer1, layer2 },
      detectorVersion: this.detectorVersion,
      inputText: normalized.inputText,
      normalizedText: normalized.normalizedText,
      inputHash: normalized.inputHash,
    };
  }
}

export function finalizeDetection(
  analysis: StaticAnalysisResult,
  llm: LlmResult | null,
): DetectionResult {
  const { layer0, layer1, layer2 } = analysis.layers;
  if (layer0.invisibleChars || layer0.lengthExceeded) {
    return {
      finalVerdict: 'block_soft',
      softReasonKey: layer0.invisibleChars ? 'invisible_chars' : 'format',
      ...analysis,
      layers: { ...analysis.layers, llm },
      reviewFlag: false,
    };
  }
  if (!llm) throw new Error('L3 result is required');

  let finalVerdict: DetectionResult['finalVerdict'] = 'pass';
  let softReasonKey: DetectionResult['softReasonKey'];
  let reviewFlag = false;
  if (layer1.hard.length > 0) {
    finalVerdict = 'block_card';
    reviewFlag = llm.verdict === 'clean' || llm.verdict === 'error';
  } else if (llm.verdict === 'injection' && llm.evidenceVerified) {
    finalVerdict = 'block_card';
  } else if (llm.verdict === 'injection') {
    finalVerdict = 'block_soft';
    softReasonKey = 'generic';
    reviewFlag = true;
  } else if (llm.verdict === 'suspicious') {
    finalVerdict = 'block_soft';
    softReasonKey = 'generic';
  } else if (layer2.hasCodeFence || layer2.hasUrl || layer2.hasBase64Like) {
    finalVerdict = 'block_soft';
    softReasonKey = 'format';
  }

  return {
    finalVerdict,
    ...(softReasonKey ? { softReasonKey } : {}),
    ...analysis,
    layers: { ...analysis.layers, llm },
    reviewFlag,
  };
}

export class InjectionDetector {
  readonly #judge: InjectionJudge;
  readonly #staticAnalyzer: InjectionStaticAnalyzer;
  readonly detectorVersion: string;

  constructor(
    judge: InjectionJudge,
    detectorVersion = 'e6-p1-patterns1-prompt1',
  ) {
    this.#judge = judge;
    this.#staticAnalyzer = new InjectionStaticAnalyzer(detectorVersion);
    this.detectorVersion = this.#staticAnalyzer.detectorVersion;
  }

  async detect(
    proposal: NormalizedProposal,
    userId: string,
  ): Promise<DetectionResult> {
    void userId;
    const analysis = this.#staticAnalyzer.analyze(proposal);
    const { layer0, layer1, layer2 } = analysis.layers;

    if (layer0.invisibleChars || layer0.lengthExceeded) {
      return finalizeDetection(analysis, null);
    }

    let llm: LlmResult;
    try {
      const judged = await this.#judge.judge({
        name: proposal.name,
        body: proposal.body,
        inputText: analysis.inputText,
        normalizedText: analysis.normalizedText,
        layer1,
        layer2,
      });
      const evidenceVerified =
        judged.evidence !== null &&
        judged.evidence.length > 0 &&
        analysis.inputText.includes(judged.evidence);
      llm = { ...judged, evidenceVerified };
    } catch (cause) {
      if (layer1.hard.length === 0) {
        throw new InjectionUnavailableError({ cause });
      }
      llm = {
        verdict: 'error',
        reason: 'judge_unavailable',
        evidence: null,
        evidenceVerified: false,
        model: null,
        latencyMs: null,
      };
    }

    return finalizeDetection(analysis, llm);
  }
}
