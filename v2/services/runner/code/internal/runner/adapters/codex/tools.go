package codex

import (
	"encoding/json"

	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
)

const commandSchema = `{"type":"object","properties":{"action":{"type":"string","enum":["start","read","wait","cancel"]},"argv":{"type":"array","items":{"type":"string"}},"id":{"type":"string"},"offset":{"type":"integer","minimum":0}},"required":["action"],"additionalProperties":false}`

const settingsChangeSchema = `{"type":"object","properties":{"revision":{"type":"integer","minimum":1,"description":"The revision lazybox_get_settings returned. A stale revision is refused."},"reason":{"type":"string","description":"One or two plain sentences for the user: what changes and why."},"changes":{"type":"object","description":"Only the settings that change; each value replaces the current one whole.","properties":{"naming":{"type":"string","enum":["repositories","generated"]},"permission":{"type":"string","enum":["","ask","read-only","yolo"]},"context":{"type":"string","maxLength":32768},"claudeContext":{"type":"string","maxLength":16384},"codexContext":{"type":"string","maxLength":16384}},"additionalProperties":false}},"required":["revision","reason","changes"],"additionalProperties":false}`

// dynamicTools are the Runner tools an execution may call, by its purpose: the
// help assistant gets the settings tools, a coding agent the managed-command
// tool, and other assistants (which have no Runner tools) none.
func dynamicTools(purpose string) []map[string]any {
	switch {
	case purpose == "help":
		return []map[string]any{
			{"type": "function", "name": agent.SettingsReadTool, "description": "Read Lazybox's agent settings (Settings → Agents & workspaces) and their revision. Never returns credentials.", "inputSchema": json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)},
			{"type": "function", "name": agent.SettingsUpdateTool, "description": "Propose a change to Lazybox's agent settings. The user sees the reason and the proposed values and must allow it; nothing changes otherwise. Changeable: naming, permission, context, claudeContext, codexContext.", "inputSchema": json.RawMessage(settingsChangeSchema)},
		}
	case agent.IsAssistant(purpose):
		return nil
	}
	return []map[string]any{{"type": "function", "name": agent.CommandTool, "description": "Start, read, wait for or cancel a runner-owned command. Output remains available to independent human consoles. Start requires human approval. Never repeat a start after receiving its command id.", "inputSchema": json.RawMessage(commandSchema)}}
}

// toolOffered reports whether name is one of the dynamic tools purpose offers.
func toolOffered(purpose, name string) bool {
	for _, t := range dynamicTools(purpose) {
		if t["name"] == name {
			return true
		}
	}
	return false
}

// toolApproval is the approval card title of a dynamic tool call; empty when
// the call runs without asking, which only reading Lazybox's settings does.
func toolApproval(name string) string {
	switch name {
	case agent.SettingsReadTool:
		return ""
	case agent.SettingsUpdateTool:
		return "Change Lazybox settings"
	}
	return "Run managed command tool"
}

// toolDeclined answers the agent when the user declines a dynamic tool call.
func toolDeclined(name string) string {
	if name == agent.SettingsUpdateTool {
		return "The user declined this settings change; nothing was saved."
	}
	return "Command declined"
}

// normalizedToolCall is the provider boundary. Consumers need no Codex item
// semantics, and reasoning/message items never become tool history.
func normalizedToolCall(raw json.RawMessage, completed bool) (json.RawMessage, error) {
	var p struct {
		Item struct {
			ID, Type, Tool, Status                                              string
			Arguments, Command, Query, Changes, Result, AggregatedOutput, Error json.RawMessage
			ExitCode                                                            *int
		}
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	i := p.Item
	names := map[string]string{"commandExecution": "Shell command", "fileChange": "File changes", "mcpToolCall": "MCP tool", "dynamicToolCall": "Tool", "webSearch": "Web search", "imageView": "View image", "collabAgentToolCall": "Sub-agent"}
	name, ok := names[i.Type]
	if !ok || i.ID == "" {
		return nil, nil
	}
	if i.Tool != "" {
		name = i.Tool
	}
	status := "running"
	if completed {
		status = "completed"
	}
	if i.Status == "failed" || i.Status == "declined" || i.Status == "error" || (len(i.Error) > 0 && string(i.Error) != "null") || (i.ExitCode != nil && *i.ExitCode != 0) {
		status = "failed"
	}
	first := func(values ...json.RawMessage) json.RawMessage {
		for _, v := range values {
			if len(v) > 0 && string(v) != "null" {
				if len(v) > 32768 {
					var text string
					if json.Unmarshal(v, &text) != nil {
						text = string(v)
					}
					if len(text) > 32768 {
						text = text[:32768]
					}
					bounded, _ := json.Marshal(text + "\n[Tool preview truncated]")
					return bounded
				}
				return v
			}
		}
		return nil
	}
	out := struct {
		Type, ID, Name, Status string
		Input, Output          json.RawMessage
	}{Type: "tool_call", ID: i.ID, Name: name, Status: status, Input: first(i.Arguments, i.Command, i.Query, i.Changes), Output: first(i.Result, i.AggregatedOutput, i.Error)}
	// Keep the JSON vocabulary identical across adapters.
	return json.Marshal(map[string]any{"type": out.Type, "id": out.ID, "name": out.Name, "status": out.Status, "input": out.Input, "output": out.Output})
}
