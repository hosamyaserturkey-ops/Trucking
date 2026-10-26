// Settings for the OpenNext adapter that builds the app for Cloudflare Workers.
// Every page reads live data per user, so no shared page cache is configured.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
