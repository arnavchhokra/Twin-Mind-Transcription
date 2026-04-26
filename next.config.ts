import type { NextConfig } from "next";

function clearBrokenStorageGlobal(name: "localStorage" | "sessionStorage") {
  const candidate = (globalThis as Record<string, unknown>)[name];
  if (!candidate || typeof candidate !== "object") {
    return;
  }

  const maybeStorage = candidate as { getItem?: unknown; setItem?: unknown };
  if (
    typeof maybeStorage.getItem === "function" &&
    typeof maybeStorage.setItem === "function"
  ) {
    return;
  }

  try {
    Reflect.deleteProperty(globalThis, name);
  } catch {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: undefined,
      writable: true,
    });
  }
}

clearBrokenStorageGlobal("localStorage");
clearBrokenStorageGlobal("sessionStorage");

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
