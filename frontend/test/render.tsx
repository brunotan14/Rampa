import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import axe from "axe-core";
import { routes } from "../src/routes";

export function renderRoute(path = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return { router, ...render(<RouterProvider router={router} />) };
}

// Contraste não é calculado no jsdom; ele é coberto pelo E2E num navegador real.
export async function axeViolations(container: Element) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}
