`pdf-import-source.pdf` was generated independently with ReportLab, without
using RichTextWeb's exporter. It contains a title, deliberately non-reading-order
text operators, two text columns, italic and accented text, a rotated page with
an embedded Unicode font, and a graphics-only page. Tests therefore cover genuine
PDF parsing rather than a round trip through only the project's own exporter.

The embedded Unicode font derives from `pdf-test-font.ttf`; see
`pdf-test-font.LICENSE.txt`. The fixture document itself is part of RichTextWeb's
MIT-licensed test suite.
