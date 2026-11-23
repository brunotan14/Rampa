import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  // A lista de auditorias recentes (RF-RA018) fica no localStorage: um teste não vê a do outro.
  try {
    window.localStorage.clear();
  } catch {
    // teste que bloqueou o armazenamento
  }
});
