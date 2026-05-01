/**
 * Vitest setup shim: closes all open better-sqlite3 connections after every
 * test suite, preventing a SIGSEGV on macOS.
 *
 * better-sqlite3 is a native addon.  When its C++ objects are garbage-collected
 * during V8 isolate teardown (e.g. at the end of a Stryker perTest run), Node
 * may SIGSEGV on macOS because the native finalizers attempt to call V8 APIs on
 * an already-shutting-down isolate.
 *
 * Registering closeAll() as an afterAll hook runs it while V8 is still fully
 * operational — after all tests complete but before the process begins exiting.
 * This is earlier than process.on('exit') and safe for synchronous cleanup.
 *
 * This file must be listed AFTER bun-globals.ts in setupFiles so that the Bun
 * shims are already installed before any test module is evaluated.
 */
import { afterAll } from "vitest";
import { closeAll } from "./bun-sqlite.ts";

afterAll(closeAll);
