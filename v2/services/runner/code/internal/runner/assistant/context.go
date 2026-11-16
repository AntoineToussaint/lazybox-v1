// Package assistant owns the product context supplied to app-wide conversations.
package assistant

import _ "embed"

//go:embed context.md
var Context string

// Settings tells the help assistant what its settings tools can change and how
// a change reaches the user. Only the help assistant has those tools.
//
//go:embed settings.md
var Settings string
