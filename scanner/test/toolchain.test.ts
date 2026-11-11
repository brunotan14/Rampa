import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// O build da imagem usa só `scanner/`, então o `.nvmrc` da raiz não entra nele. Este teste
// amarra as três referências: a tag da imagem do Playwright no Dockerfile, a versão do
// pacote `playwright` e a versão do Node que a tag traz, registrada no Dockerfile e no `.nvmrc`.
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const dockerfile = read("../Dockerfile");
const nvmrc = read("../../.nvmrc").trim();
const pkg = JSON.parse(read("../package.json")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const IMAGE_FROM = /^FROM\s+mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-\S+/m;
const IMAGE_NODE = /^# Node da imagem: (\S+)$/m;

describe("versões da imagem do scanner", () => {
  it("a tag da imagem do Playwright é a mesma versão do pacote playwright", () => {
    const tag = IMAGE_FROM.exec(dockerfile)?.[1];
    expect(tag, "scanner/Dockerfile precisa de um FROM mcr.microsoft.com/playwright:v<versão>-<distro>").toBeDefined();

    const declared = pkg.dependencies?.playwright ?? pkg.devDependencies?.["@playwright/test"];
    expect(declared, "scanner/package.json precisa declarar playwright ou @playwright/test").toBeDefined();

    expect(
      tag,
      `a imagem do Dockerfile (playwright:v${tag ?? "?"}) não é a versão do playwright no package.json (${declared ?? "?"}): ` +
        "o Chromium da imagem não seria o que o pacote espera. Atualize os dois juntos.",
    ).toBe(declared);
  });

  it("o .nvmrc tem a versão do Node que a imagem traz", () => {
    expect(nvmrc, ".nvmrc precisa ter uma versão exata (x.y.z)").toMatch(/^\d+\.\d+\.\d+$/);

    const imageNode = IMAGE_NODE.exec(dockerfile)?.[1];
    expect(imageNode, "scanner/Dockerfile precisa da linha '# Node da imagem: x.y.z'").toBeDefined();

    expect(
      nvmrc,
      `o .nvmrc (${nvmrc}) não é o Node da imagem do scanner (${imageNode ?? "?"}): local, CI e produção ` +
        "precisam rodar a mesma versão. Confira com `docker run --rm <imagem> node --version`.",
    ).toBe(imageNode);
  });
});
