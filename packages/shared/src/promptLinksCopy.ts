import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import {
  type LinkedPrompt,
  type NewThreadLink,
  parseNewThreadLink as parseNewThreadLinkWith,
  parseThreadLinkPrompt as parseThreadLinkPromptWith,
  PROMPT_LINK_MAX_PROMPT_LENGTH,
  type PromptLinkError,
  type PromptLinkResult,
} from "./promptLinks.ts";
import { PRODUCT_NAME } from "./appIdentity.ts";

function promptLinkErrorMessage(error: PromptLinkError, resolve: MFunctionType): string {
  switch (error) {
    case "prompt-too-long":
      return resolve(
        msg("This prompt is longer than {maxLength} characters, so {app} did not open it.", {
          maxLength: PROMPT_LINK_MAX_PROMPT_LENGTH.toLocaleString("en-US"),
          app: PRODUCT_NAME,
        }),
      );
    case "prompt-only-hidden":
      return resolve(
        msg(
          "This prompt had only hidden characters, so it may be malicious. {app} did not open it.",
          { app: PRODUCT_NAME },
        ),
      );
    case "unreadable-pull-request":
      return resolve(
        msg("This link names a pull request {app} cannot read.", { app: PRODUCT_NAME }),
      );
    case "missing-prompt":
      return resolve(msg("This link has no prompt."));
    case "unreadable-repository":
      return resolve(msg("This link names a repository {app} cannot read.", { app: PRODUCT_NAME }));
  }
}

/** @public */
export function parseNewThreadLink(
  search: string,
  resolve: MFunctionType = mFallback,
): PromptLinkResult<NewThreadLink> {
  return parseNewThreadLinkWith(search, (error) => promptLinkErrorMessage(error, resolve));
}

/** @public */
export function parseThreadLinkPrompt(
  search: string,
  resolve: MFunctionType = mFallback,
): PromptLinkResult<LinkedPrompt | null> {
  return parseThreadLinkPromptWith(search, (error) => promptLinkErrorMessage(error, resolve));
}
