// resolvers/index.js
// No custom resolvers needed — all Login Module operations are handled by the
// OpenAPI handler in mesh.json which auto-generates GraphQL mutations from
// the openapi.json spec (otpAction, customerAction).
//
// Commerce GraphQL types pass through from the Commerce source.
//
// This file is kept as a placeholder. If you ever need additionalResolvers
// (e.g. to create alias mutations with friendlier names), add them here and
// reference this file in mesh.json:
//   "additionalResolvers": ["./resolvers/index.js"]

module.exports = {}