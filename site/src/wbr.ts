/**
 * Tool and field names are long snake_case words ("email_test_analyze"). In a narrow column they
 * should wrap after an underscore, not in the middle of a word, so each underscore is followed by
 * a <wbr> (built with the DOM, never with innerHTML: names can come from tool output).
 */
export function breakAtUnderscores(name: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  name.split(/(?<=_)/).forEach((part, i) => {
    if (i > 0) fragment.append(document.createElement("wbr"));
    fragment.append(part);
  });
  return fragment;
}
