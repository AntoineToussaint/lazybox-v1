package agent

import (
	"strings"
	"testing"
)

func TestPromptPreservesUserTextAndProvidesEscapedGenericFileReferences(t *testing.T) {
	if Prompt(Operation{Text: "plain"}) != "plain" {
		t.Fatal("plain prompt changed")
	}
	file := File{Name: `quoted "report".pdf`, Path: `/runner/attachments/quoted "report".pdf`, MediaType: "application/pdf", Size: 10}
	text := Prompt(Operation{Text: "Read the report", Files: []File{file}})
	prefix, reference, ok := strings.Cut(text, "\n\n")
	if !ok || prefix != "Read the report" || reference != `Attached file "quoted \"report\".pdf" (application/pdf, 10 B), retained on this Runner at "/runner/attachments/quoted \"report\".pdf": read it as needed.` {
		t.Fatalf("generic file references were not delivered escaped: %q", text)
	}
}
