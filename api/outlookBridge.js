"use strict";

// Explicit Vercel Function entry point. This avoids platform-level 404s when
// Express auto-detection or edge rewrites do not forward /outlookBridge.
const { outlookBridge } = require("../server/outlook-runtime");
module.exports = outlookBridge;
