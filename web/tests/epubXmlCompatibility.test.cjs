const assert = require("node:assert/strict");
const { parse } = require("epubjs/lib/utils/core");
const Container = require("epubjs/lib/container").default;
const Packaging = require("epubjs/lib/packaging").default;
const Navigation = require("epubjs/lib/navigation").default;

it("parses EPUB container, package, and NCX with the overridden XML parser", () => {
  const container = new Container(parse(
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "application/xml",
    true,
  ));
  assert.equal(container.packagePath, "OPS/package.opf");

  const pkg = new Packaging(parse(
    '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="bookid"><metadata><dc:identifier id="bookid">urn:uuid:example</dc:identifier><dc:title>XML compatibility</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    "application/xml",
    true,
  ));
  assert.equal(pkg.metadata.title, "XML compatibility");
  assert.equal(pkg.spine[0].idref, "chapter");
  assert.equal(pkg.manifest.chapter.href, "chapter.xhtml");
  assert.equal(pkg.navPath, "nav.xhtml");

  const toc = new Navigation(parse(
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="chapter"><navLabel><text>Chapter One</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>',
    "application/xml",
    true,
  ));
  assert.equal(toc.toc[0].label, "Chapter One");
  assert.equal(toc.toc[0].href, "chapter.xhtml");
});
