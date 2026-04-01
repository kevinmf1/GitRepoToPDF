#!/usr/bin/env node
import fs from "fs";
const fsPromises = fs.promises;
import path from "path";

import git from "simple-git";
import PDFDocument from "pdfkit";
import hljs from "highlight.js";
import { isBinaryFileSync } from "isbinaryfile";
import strip from "strip-comments";
import prettier from "prettier";
// @ts-ignore
import SVGtoPDF from "svg-to-pdfkit";

import { htmlToJson } from "./syntax";
import loadIgnoreConfig, { IgnoreConfig } from "./loadIgnoreConfig";
import {
  universalExcludedExtensions,
  universalExcludedNames,
} from "./universalExcludes";
import { configQuestions } from "./configHandler";

//@ts-ignore
import type chalkType from "chalk";
//@ts-ignore
import type inquirerType from "inquirer";
//@ts-ignore
import type oraType from "ora";

const renderableRasterImageExtensions = new Set([".png", ".jpg", ".jpeg"]);

function getPrettierParser(extension: string): string | null {
  const parserOptions: { [key: string]: string } = {
    js: "babel",
    jsx: "babel",
    ts: "typescript",
    tsx: "typescript",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    json: "json",
    md: "markdown",
    yaml: "yaml",
    graphql: "graphql",
    vue: "vue",
    angular: "angular",
    xml: "xml",
    java: "java",
    kotlin: "kotlin",
    swift: "swift",
    php: "php",
    ruby: "ruby",
    python: "python",
    perl: "perl",
    shell: "sh",
    dockerfile: "dockerfile",
    ini: "ini",
  };
  return parserOptions[extension] || null;
}

let chalk: typeof chalkType;
let inquirer: typeof inquirerType;
let ora: typeof oraType;

const spinnerPromise = import("ora").then((oraModule) => {
  ora = oraModule.default;
  return ora("Setting everything up...").start();
});

Promise.all([
  import("chalk").then((chalkModule) => chalkModule.default),
  import("inquirer").then((inquirerModule) => inquirerModule.default),
  spinnerPromise,
])
  .then(([chalkModule, inquirerModule, spinner]) => {
    chalk = chalkModule;
    inquirer = inquirerModule;
    spinner.succeed("Setup complete");
    configQuestions(main, chalk, inquirer);
  })
  .catch((err) => {
    spinnerPromise.then((spinner) => {
      spinner.fail("An error occurred during setup");
    });
    console.error(err);
  });

async function main(
  repoPath: string,
  useLocalRepo: boolean,
  addLineNumbers: boolean,
  addHighlighting: boolean,
  addPageNumbers: boolean,
  removeComments: boolean,
  removeEmptyLines: boolean,
  formatMarkdown: boolean,
  onePdfPerFile: boolean,
  outputFileName: fs.PathLike,
  outputFolderName: string,
  keepRepo: boolean,
) {
  const gitP = git();
  let tempDir = "./tempRepo";

  let doc: typeof PDFDocument | null = null;
  if (!onePdfPerFile) {
    doc = new PDFDocument({
      bufferPages: true,
      autoFirstPage: false,
    });
    doc.pipe(fs.createWriteStream(outputFileName));
    doc.addPage();
  }

  let fileCount = 0;
  let ignoreConfig: IgnoreConfig | null = null;
  const spinner = ora(chalk.blueBright("Setting everything up...")).start();
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  try {
    if (useLocalRepo) {
      tempDir = repoPath;
    } else {
      spinner.start(chalk.blueBright("Cloning repository..."));
      await gitP.clone(repoPath, tempDir);
      spinner.succeed(chalk.greenBright("Repository cloned successfully"));
    }

    spinner.start(chalk.blueBright("Processing files..."));
    ignoreConfig = await loadIgnoreConfig(tempDir);
    await appendFilesToPdf(tempDir, removeComments);

    if (!onePdfPerFile) {
      if (doc) {
        doc.text("", { continued: false }); // ensure text flow is closed before adding page numbers
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
          doc.switchToPage(i);
          if (addPageNumbers) {
            const oldBottomMargin = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;
            doc.text(
              `Page: ${i + 1} of ${pages.count}`,
              0,
              doc.page.height - oldBottomMargin / 2,
              {
                align: "center",
              },
            );
            doc.page.margins.bottom = oldBottomMargin;
          }
        }
        doc.end();
      }
    }

    spinner.succeed(
      chalk.greenBright(
        `${
          onePdfPerFile ? "PDFs" : "PDF"
        } created with ${fileCount} files processed.`,
      ),
    );

    if (!keepRepo && !useLocalRepo) {
      await delay(3000);
      fs.rmSync(tempDir, { recursive: true, force: true });
      spinner.succeed(
        chalk.greenBright("Temporary repository has been deleted."),
      );
    }
  } catch (err) {
    spinner.fail(chalk.redBright("An error occurred"));
    console.error(err);
  }

  async function appendFilesToPdf(directory: string, removeComments = false) {
    const files = await fsPromises.readdir(directory);

    const excludedNames = new Set([
      ...universalExcludedNames,
      ...(ignoreConfig?.ignoredFiles ?? []),
    ]);
    const excludedExtensions = new Set(
      [
        ...universalExcludedExtensions,
        ...(ignoreConfig?.ignoredExtensions ?? []),
      ].map((ext) => ext.toLowerCase()),
    );
    const includedExtensions = new Set(
      (ignoreConfig?.includedExtensions ?? []).map((ext) => ext.toLowerCase()),
    );

    for (const file of files) {
      const filePath = path.join(directory, file);
      const stat = await fsPromises.stat(filePath);

      const fileNameOnly = path.basename(filePath);
      const fileExt = path.extname(filePath).toLowerCase();

      // Check if file or directory should be excluded
      if (
        excludedNames.has(fileNameOnly) ||
        (excludedExtensions.has(fileExt) && !includedExtensions.has(fileExt))
      ) {
        continue;
      }

      if (stat.isFile()) {
        fileCount++;
        spinner.text = chalk.blueBright(
          `Processing files... (${fileCount} processed)`,
        );
        const fileName = path.relative(tempDir, filePath);

        if (onePdfPerFile) {
          doc = new PDFDocument({
            bufferPages: true,
            autoFirstPage: false,
          });

          const pdfFileName = path
            .join(outputFolderName, fileName.replace(path.sep, "_"))
            .concat(".pdf");

          await fsPromises.mkdir(path.dirname(pdfFileName), {
            recursive: true,
          });
          doc.pipe(fs.createWriteStream(pdfFileName));
          doc.addPage();
        }

        if (doc) {
          // fix new line number starting on previous line
          if (!onePdfPerFile && fileCount > 1) doc.text("\n");

          if (fileExt === ".svg") {
            if (fileCount > 1) doc.addPage();

            doc.font("Courier").fontSize(10).text(`${fileName}\n`, {
              lineGap: 4,
            });

            const maxWidth =
              doc.page.width - doc.page.margins.left - doc.page.margins.right;
            const maxHeight =
              doc.page.height -
              doc.page.margins.top -
              doc.page.margins.bottom -
              20;

            try {
              const svgData = await fsPromises.readFile(filePath, "utf8");
              SVGtoPDF(doc, svgData, doc.x, doc.y, {
                width: maxWidth,
                height: maxHeight,
                preserveAspectRatio: "xMidYMid meet",
              });
              doc.moveDown();
            } catch {
              const data = fs.readFileSync(filePath).toString("base64");
              doc
                .font("Courier")
                .fontSize(10)
                .text(`\nBASE64:\n\n${data}`, { lineGap: 4 });
            }
          } else if (isBinaryFileSync(filePath)) {
            if (fileCount > 1) doc.addPage();

            if (renderableRasterImageExtensions.has(fileExt)) {
              doc.font("Courier").fontSize(10).text(`${fileName}\n`, {
                lineGap: 4,
              });

              const maxWidth =
                doc.page.width - doc.page.margins.left - doc.page.margins.right;
              const maxHeight =
                doc.page.height -
                doc.page.margins.top -
                doc.page.margins.bottom -
                20;

              try {
                doc.image(filePath, {
                  fit: [maxWidth, maxHeight],
                  align: "center",
                  valign: "center",
                });
                doc.moveDown();
              } catch {
                const data = fs.readFileSync(filePath).toString("base64");
                doc
                  .font("Courier")
                  .fontSize(10)
                  .text(`\nBASE64:\n\n${data}`, { lineGap: 4 });
              }
            } else {
              const data = fs.readFileSync(filePath).toString("base64");
              doc
                .font("Courier")
                .fontSize(10)
                .text(`${fileName}\n\nBASE64:\n\n${data}`, { lineGap: 4 });
            }
          } else {
            let data = await fsPromises.readFile(filePath, "utf8");
            const extension = path.extname(filePath).slice(1);

            if (formatMarkdown && (extension === "md" || extension === "mdx")) {
              const { marked } = await import("marked");
              if (fileCount > 1 && !onePdfPerFile) doc.addPage();
              doc
                .font("Helvetica-Bold")
                .fontSize(14)
                .text(`${fileName}\n`, { lineGap: 4 });
              doc.moveDown(0.5);
              const tokens = marked.lexer(data);

              const stripHtml = (htmlStr: string) => {
                return htmlStr
                  .replace(/<[^>]*>?/gm, "")
                  .replace(/&nbsp;/g, " ")
                  .replace(/&lt;/g, "<")
                  .replace(/&gt;/g, ">");
              };

              const drawImage = (imgRelPath: string) => {
                const isAbsoluteImgPath = imgRelPath.startsWith("/");
                const baseDir = isAbsoluteImgPath
                  ? tempDir
                  : path.dirname(filePath);
                const absImgPath = path.resolve(
                  baseDir,
                  imgRelPath.replace(/^\//, ""),
                );
                if (fs.existsSync(absImgPath)) {
                  const ext = path.extname(absImgPath).toLowerCase();
                  const maxWidth =
                    doc!.page.width -
                    doc!.page.margins.left -
                    doc!.page.margins.right;
                  doc!.moveDown(0.5);
                  const oldX = doc!.x;
                  const MAX_INLINE_IMAGE_HEIGHT = 300;

                  if (ext === ".svg") {
                    try {
                      const svgData = fs.readFileSync(absImgPath, "utf8");
                      if (
                        doc!.y + MAX_INLINE_IMAGE_HEIGHT >
                        doc!.page.height - doc!.page.margins.bottom
                      ) {
                        doc!.addPage();
                      }

                      SVGtoPDF(doc, svgData, doc!.x, doc!.y, {
                        width: maxWidth,
                        height: MAX_INLINE_IMAGE_HEIGHT,
                        preserveAspectRatio: "xMidYMid meet",
                      });
                      doc!.y += MAX_INLINE_IMAGE_HEIGHT + 20; // Advance Y
                    } catch (e) {
                      // handle fail
                    }
                  } else if (renderableRasterImageExtensions.has(ext)) {
                    try {
                      // @ts-ignore
                      const imgObj = doc!.openImage(absImgPath);
                      const iw = imgObj.width;
                      const ih = imgObj.height;
                      const scale = Math.min(
                        maxWidth / iw,
                        MAX_INLINE_IMAGE_HEIGHT / ih,
                      );
                      const finalH = ih * scale;

                      if (
                        doc!.y + finalH >
                        doc!.page.height - doc!.page.margins.bottom
                      ) {
                        doc!.addPage();
                      }

                      doc!.image(absImgPath, doc!.x, doc!.y, {
                        fit: [maxWidth, MAX_INLINE_IMAGE_HEIGHT],
                        align: "center",
                        valign: "center",
                      });
                      doc!.y += finalH + 20; // Advance Y
                    } catch (e) {}
                  }
                  doc!.x = oldX;
                }
              };

              const renderInline = (
                inlineTokens: any[] | undefined,
                defaultFont: string,
                size: number,
                indent: number = 0,
              ) => {
                if (!inlineTokens) return;
                doc!.fontSize(size);

                // Collect text segments since we may have images breaking the flow
                const flattened: {
                  text: string;
                  font: string;
                  isImage: boolean;
                  href?: string;
                }[] = [];

                const traverse = (
                  tokensToTraverse: any[],
                  currentFont: string,
                ) => {
                  for (const t of tokensToTraverse) {
                    let font = currentFont;
                    if (t.type === "strong") font = "Helvetica-Bold";
                    else if (t.type === "em") font = "Helvetica-Oblique";
                    else if (t.type === "codespan") font = "Courier";

                    if (t.type === "image") {
                      flattened.push({
                        text: t.text,
                        font,
                        isImage: true,
                        href: t.href,
                      });
                    } else if (t.tokens && t.tokens.length > 0) {
                      traverse(t.tokens, font);
                    } else {
                      flattened.push({
                        text: t.text || t.raw || "",
                        font,
                        isImage: false,
                      });
                    }
                  }
                };
                traverse(inlineTokens, defaultFont);

                for (let i = 0; i < flattened.length; i++) {
                  const item = flattened[i];
                  if (item.isImage && item.href) {
                    doc!.text("\n", { continued: false }); // close continued text stream
                    drawImage(item.href);
                    continue;
                  }

                  const isLast =
                    i === flattened.length - 1 || flattened[i + 1].isImage;
                  const text = stripHtml(item.text).replace(/\n/g, " ");
                  if (!text) continue;

                  const opts: any = { continued: !isLast };
                  if (i === 0 && indent > 0) opts.indent = indent;

                  doc!.font(item.font).text(text, opts);
                }
              };

              doc.font("Helvetica").fontSize(12);
              for (const token of tokens) {
                if (token.type === "heading") {
                  doc.moveDown(0.5);
                  doc
                    .font("Helvetica-Bold")
                    .fontSize(Math.max(12, 24 - token.depth * 2))
                    .text(stripHtml(token.text));
                  doc.moveDown(0.5);
                } else if (token.type === "paragraph") {
                  renderInline(token.tokens, "Helvetica", 12);
                  doc.moveDown(0.5);
                } else if (token.type === "list") {
                  for (const item of token.items) {
                    doc
                      .font("Helvetica")
                      .fontSize(12)
                      .text("\u2022 ", { continued: true, indent: 10 });
                    renderInline(item.tokens, "Helvetica", 12, 0);
                  }
                  doc.moveDown(0.5);
                } else if (token.type === "code") {
                  doc.moveDown(0.5);
                  doc
                    .font("Courier")
                    .fontSize(10)
                    .text(token.text, { indent: 10 });
                  doc.moveDown(0.5);
                } else if (token.type === "table") {
                  doc.moveDown(0.5);
                  const headers = token.header.map((h: any) =>
                    stripHtml(h.text),
                  );
                  for (let r = 0; r < token.rows.length; r++) {
                    const row = token.rows[r];
                    doc
                      .font("Helvetica-Bold")
                      .fontSize(11)
                      .text(`Row ${r + 1}:`, { indent: 10 });
                    for (let c = 0; c < row.length; c++) {
                      const cellText = stripHtml(row[c].text);
                      doc
                        .font("Helvetica-Bold")
                        .fontSize(10)
                        .text(`  - ${headers[c] || "Col " + (c + 1)}: `, {
                          continued: true,
                          indent: 20,
                        });
                      doc.font("Helvetica").fontSize(10).text(cellText);
                    }
                    doc.moveDown(0.2);
                  }
                  doc.moveDown(0.5);
                } else if (token.type === "space") {
                  // ignore
                } else {
                  // generic fallback
                  doc.font("Helvetica").fontSize(12).text(stripHtml(token.raw));
                  doc.moveDown(0.5);
                }
              }
              if (onePdfPerFile) {
                doc?.end();
              }
              continue;
            }

            // Determine parser and format with Prettier if supported
            const parser = getPrettierParser(extension);

            if (parser) {
              try {
                data = await prettier.format(data, { parser });
              } catch (error: unknown) {
                const errorMessage = (error as Error).message.split("\n")[0];
                console.warn(
                  `Plain text fallback at ${filePath}: ${errorMessage}`,
                );
              }
            }

            data = data.replace(/\t/g, "    ");
            data = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

            if (removeComments) {
              data = strip(data);
            }

            if (removeEmptyLines) {
              data = data.replace(/^\s*[\r\n]/gm, "");
            }

            let highlightedCode;
            try {
              if (addHighlighting && hljs.getLanguage(extension)) {
                highlightedCode = hljs.highlight(data, {
                  language: extension,
                }).value;
              } else {
                highlightedCode = hljs.highlight(data, {
                  language: "plaintext",
                }).value;
              }
            } catch (error) {
              highlightedCode = hljs.highlight(data, {
                language: "plaintext",
              }).value;
            }

            const hlData = htmlToJson(highlightedCode, removeEmptyLines);
            let lineNum = 1;
            let currentLineText = "";
            const lineNumWidth = hlData
              .filter((d) => d.text === "\n")
              .length.toString().length;
            for (let i = 0; i < hlData.length; i++) {
              const { text, color } = hlData[i];
              if (i === 0 || hlData[i - 1]?.text === "\n") {
                currentLineText = "";
                if (addLineNumbers) {
                  doc.text(
                    String(lineNum++).padStart(lineNumWidth, " ") + " ",
                    {
                      continued: true,
                      textIndent: 0,
                    },
                  );
                }
              }
              doc.fillColor(color || "black");

              if (text !== "\n") {
                currentLineText += text;
                doc.text(text, { continued: true });
              } else {
                doc.text(text);
                // check for markdown image syntax: ![alt](path) or just file path mapping
                // matches ![alt](path) or (path) where path ends in an image extension
                const imgMatch = currentLineText.match(
                  /(?:!\[.*?\])?\(([^)]+\.(?:svg|png|jpg|jpeg))\)/i,
                );
                if (imgMatch) {
                  const imgRelPath = imgMatch[1];
                  // If path starts with /, resolve from repo root (tempDir).
                  // Otherwise resolve relative to current file's directory.
                  const isAbsoluteImgPath = imgRelPath.startsWith("/");
                  const baseDir = isAbsoluteImgPath
                    ? tempDir
                    : path.dirname(filePath);
                  const absImgPath = path.resolve(
                    baseDir,
                    imgRelPath.replace(/^\//, ""),
                  );
                  if (fs.existsSync(absImgPath)) {
                    const ext = path.extname(absImgPath).toLowerCase();
                    const maxWidth =
                      doc.page.width -
                      doc.page.margins.left -
                      doc.page.margins.right;
                    doc.moveDown(0.5);
                    const oldX = doc.x;

                    const MAX_INLINE_IMAGE_HEIGHT = 300;

                    if (ext === ".svg") {
                      try {
                        const svgData = fs.readFileSync(absImgPath, "utf8");
                        if (
                          doc.y + MAX_INLINE_IMAGE_HEIGHT >
                          doc.page.height - doc.page.margins.bottom
                        ) {
                          doc.addPage();
                        }

                        SVGtoPDF(doc, svgData, doc.x, doc.y, {
                          width: maxWidth,
                          height: MAX_INLINE_IMAGE_HEIGHT,
                          preserveAspectRatio: "xMidYMid meet",
                        });
                        doc.y += MAX_INLINE_IMAGE_HEIGHT + 20; // Advance Y
                      } catch (e) {
                        // handle fail
                      }
                    } else if (renderableRasterImageExtensions.has(ext)) {
                      try {
                        // @ts-ignore
                        const imgObj = doc.openImage(absImgPath);
                        const iw = imgObj.width;
                        const ih = imgObj.height;
                        const scale = Math.min(
                          maxWidth / iw,
                          MAX_INLINE_IMAGE_HEIGHT / ih,
                        );
                        const finalH = ih * scale;

                        if (
                          doc.y + finalH >
                          doc.page.height - doc.page.margins.bottom
                        ) {
                          doc.addPage();
                        }

                        doc.image(absImgPath, doc.x, doc.y, {
                          fit: [maxWidth, MAX_INLINE_IMAGE_HEIGHT],
                          align: "center",
                          valign: "center",
                        });
                        doc.y += finalH + 20; // Advance Y
                      } catch (e) {}
                    }
                    doc.x = oldX;
                  }
                }
              }
            }
          }
        }

        if (onePdfPerFile) {
          doc?.end();
        }
      } else if (stat.isDirectory()) {
        await appendFilesToPdf(filePath, removeComments);
      }
    }
  }

  if (!onePdfPerFile) {
    doc?.on("finish", () => {
      spinner.succeed(
        chalk.greenBright(`PDF created with ${fileCount} files processed.`),
      );
    });
  }
}
