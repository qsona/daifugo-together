# CX-01 Structured Output Compatibility Design

## Goal

Make CX-01 submit a Structured Outputs schema accepted by the current Codex
app-server while preserving the existing judgement, SPEC, scaffold, database,
and implementation contracts.

## Root cause

`CX01_OUTPUT_SCHEMA` uses JSON Schema keywords outside the Structured Outputs
subset. The observed request is rejected before model execution because
`spec.hooks` contains `uniqueItems`. Removing only that keyword risks exposing
the next unsupported keyword in the same schema.

## Design

### Transport schema

The schema passed as `turn/start.outputSchema` will use only the supported
subset needed by CX-01:

- object, array, string, number, integer, null, `anyOf`, and `enum`;
- `required` and `additionalProperties: false` for every fixed object;
- `pattern` for constrained strings;
- `minItems` and `maxItems` for arrays;
- `minimum` and `maximum` for confidence.

The transport schema will not use `uniqueItems`, `minLength`, `maxLength`,
`maxProperties`, `propertyNames`, or schema-valued `additionalProperties`.
`specVersion` will use `enum: [1]` instead of `const: 1`.

### Dynamic messages

The domain contract represents messages as:

```ts
Record<string, string>
```

A strict Structured Outputs object cannot have arbitrary property names. The
model-facing transport therefore represents messages as:

```ts
Array<{ key: string; value: string }>
```

The transport objects have fixed required fields and
`additionalProperties: false`. Immediately after JSON parsing, CX-01 converts
the array back to the existing record before calling `parseAiJudgement()`.
Duplicate keys or malformed entries make the output invalid rather than
silently overwriting a message.

### Validation boundary

The transport schema constrains shape and bounded collections. Existing
application validation remains authoritative for:

- string lengths and non-empty values;
- allowed hooks and effects and their compatibility;
- duplicate removal for hook/effect/test-point lists;
- message key/value limits;
- visible-text injection patterns;
- verdict-specific nullable fields and reject category/subtype pairs.

No database, API, SPEC, scaffold, or implementation input format changes.

### Prompt version

The prompt will describe messages as `{ key, value }[]`, including an empty
array when no announce text is needed. `CX01_PROMPT_VERSION` advances from
`cx01-v1` to `cx01-v2` so stored judgements identify the changed output
contract.

## Error handling

Schema compatibility is enforced before runtime by a recursive test that
rejects unsupported schema keywords and verifies fixed-object requirements.
Model output that cannot be normalized still follows the existing invalid
structured-output path. Retry policy is unchanged in this fix.

## Testing

1. Add a regression assertion that recursively checks the actual
   `turn/start.outputSchema` for the supported keyword subset.
2. Change the fake CX-01 transport response to use message entries and verify
   the public result still contains the existing message record.
3. Verify duplicate message keys are rejected as invalid structured output.
4. Run the pipeline test suite and typecheck.
5. After merge, rerun `judge`; the E6-passed proposal remains eligible and
   should proceed through CX-01 without repeating E6.
