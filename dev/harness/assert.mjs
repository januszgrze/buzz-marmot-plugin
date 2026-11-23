// Waiting on and poking the rendered page.
import { dom } from "./dom.mjs";
import { last, newAction } from "./buzz.mjs";

export const text = () => document.getElementById("root").textContent;
/** Polls `predicate` until it returns something truthy, or fails with the page text. */
export async function waitFor(what, predicate, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}; page text: ${text().slice(0, 600)}`);
}
export const byText = (tag, label) => [...document.querySelectorAll(tag)].find((el) => el.textContent.trim() === label);
export const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
export const submit = (value) => last.composer.submission.submit({ text: value, recipients: [] });
export const setInput = (input, value) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
/** Opens New encrypted chat from the section's "+" action. */
export async function openNewChat() {
  await newAction.onSelect();
  await waitFor("the New chat view", () => last.composer?.channelId === "marmot:new");
}
