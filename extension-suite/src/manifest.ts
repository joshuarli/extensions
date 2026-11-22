import { allowRightClickManifest } from "../../extension-allow-right-click/src/manifest.fragment.ts";
import { chatgptManifest } from "../../extension-chatgpt/src/manifest.fragment.ts";
import { onefileManifest } from "../../extension-onefile/src/manifest.fragment.ts";
import { xBookmarksManifest } from "../../extension-x-bookmarks/src/manifest.fragment.ts";
import { youtubeTranscriptManifest } from "../../extension-youtube-transcript/src/manifest.fragment.ts";
import {
  suiteDescription,
  suiteName,
  suiteShortName,
  suiteVersion,
} from "./identity.ts";

interface FeatureManifest {
  readonly permissions: readonly chrome.runtime.ManifestPermission[];
  readonly host_permissions?: readonly string[];
}

export const featureManifests: readonly FeatureManifest[] = [
  allowRightClickManifest,
  onefileManifest,
  youtubeTranscriptManifest,
  xBookmarksManifest,
  chatgptManifest,
];

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function featurePermissions(): chrome.runtime.ManifestPermission[] {
  return unique(featureManifests.flatMap((feature) => [...feature.permissions]));
}

function featureHostPermissions(): string[] {
  return unique(
    featureManifests.flatMap((feature) =>
      "host_permissions" in feature ? [...feature.host_permissions] : [],
    ),
  );
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
    default_title: suiteName,
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
  permissions: featurePermissions(),
  host_permissions: featureHostPermissions(),
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
