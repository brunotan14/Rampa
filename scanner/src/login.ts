import type { Page } from "playwright";
import type { LoginWallFacts } from "./contract.gen.js";

// Fatos para o aviso de barreira de login (RF-RA028). O scanner não decide se a página pede
// login: só informa se há campo de senha visível. Quem decide, junto com `final_url` e o
// status HTTP, é o backend (`Rampa.Audits.LoginWall`).
//
// Só o documento principal (o locator da página não entra em iframes; entra em shadow DOM
// aberto). Visível segundo o Playwright: com tamanho, fora de `display: none` e de
// `visibility: hidden`. O locator roda no mundo isolado do Playwright: um script da página
// que troque `querySelectorAll` não engana a contagem.
const PASSWORD_SELECTOR = 'input[type="password" i]';

// Falha da checagem (página navegou, contexto destruído) rejeita a promessa; quem a trata é o
// `server.ts` (`collectLoginWall`), o único lugar da regra "nunca derruba a varredura".
export async function loginWallFacts(page: Page): Promise<LoginWallFacts> {
  const visible = await page.locator(PASSWORD_SELECTOR).filter({ visible: true }).count();
  return { password_field: visible > 0 };
}
