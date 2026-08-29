// `server-only` is a build-time guard: importing it from a Client Component is
// a bundler error, and it has no runtime behaviour. Vite cannot resolve it (it
// is Next's dependency, not this app's), so tests alias it here to keep the
// marker on server modules while still being able to unit-test their logic.
export {};
