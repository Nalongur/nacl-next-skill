/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NACL_ADAPTER?: "ipc" | "mock";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
