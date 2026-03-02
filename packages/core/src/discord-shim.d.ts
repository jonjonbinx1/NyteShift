// Ambient declaration so that TypeScript compilation doesn't fail when
// `discord.js` is not installed.  The runtime code lazily imports the
// library and throws a clear error if it's unavailable, matching the
// comment at the top of discordBridge.ts.

// Without this shim, `tsc` will emit "Cannot find module 'discord.js'"
// during builds on machines where the package hasn't been added to
// node_modules (e.g. CI or a fresh laptop).  The shim ensures the
// import resolves to `any` and keeps the package optional.

declare module "discord.js" {
  const value: any;
  export = value;
}
