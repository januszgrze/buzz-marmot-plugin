// jsdom globals, installed before React loads, and buzz-app's React.
import { require } from "./config.mjs";

const { JSDOM } = require("jsdom");
export const dom = new JSDOM("<!doctype html><div id=root></div><div id=settings></div>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "Event", "MouseEvent", "KeyboardEvent", "Node", "MutationObserver"])
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
for (const key of ["requestAnimationFrame", "cancelAnimationFrame"])
  Object.defineProperty(globalThis, key, { value: dom.window[key].bind(dom.window), configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
export const React = require("react");
export const { createRoot } = require("react-dom/client");
export const h = React.createElement;
