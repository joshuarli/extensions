import { allowRightClickManifest } from "../../extension-allow-right-click/src/manifest.fragment.ts";
import { onefileManifest } from "../../extension-onefile/src/manifest.fragment.ts";
import { xBookmarksManifest } from "../../extension-x-bookmarks/src/manifest.fragment.ts";
import { youtubeTranscriptManifest } from "../../extension-youtube-transcript/src/manifest.fragment.ts";
import {
  suiteActionTitle,
  suiteDescription,
  suiteName,
  suiteShortName,
  suiteVersion,
} from "./identity.ts";

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export const manifest = {
  manifest_version: 3,
  name: suiteName,
  short_name: suiteShortName,
  version: suiteVersion,
  description: suiteDescription,
  minimum_chrome_version: "120",
  icons: {
    "16": "icons/16.png",
    "32": "icons/32.png",
    "48": "icons/48.png",
    "128": "icons/128.png",
  },
  action: {
    default_title: suiteActionTitle,
    default_popup: "popup.html",
    default_icon: {
      "16": "icons/16.png",
      "32": "icons/32.png",
      "48": "icons/48.png",
    },
  },
  background: {
    service_worker: "service-worker.js",
    type: "module",
  },
  options_page: "options.html",
  permissions: unique([
    ...allowRightClickManifest.permissions,
    ...onefileManifest.permissions,
    ...youtubeTranscriptManifest.permissions,
    ...xBookmarksManifest.permissions,
  ]),
  host_permissions: unique([
    ...youtubeTranscriptManifest.host_permissions,
    ...xBookmarksManifest.host_permissions,
  ]),
  content_security_policy: youtubeTranscriptManifest.content_security_policy,
  externally_connectable: {
    matches: [...youtubeTranscriptManifest.externally_connectable.matches],
  },
  declarative_net_request: {
    rule_resources: youtubeTranscriptManifest.declarative_net_request.rule_resources.map(
      (rule) => ({ ...rule }),
    ),
  },
} satisfies chrome.runtime.ManifestV3;
