/** クラス名の条件付き連結。false / undefined は落とす。 */
export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter((value) => typeof value === 'string').join(' ');
}
