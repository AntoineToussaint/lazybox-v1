package power

import (
	"gopkg.in/yaml.v3"
)

// settings.yaml: the app's preferences that are safe to keep in a file
// (POWER.md, "Config files"). Only what holds no secret and needs no
// approval lives here: credentials, subscriptions, devices, the Runner's own
// settings and anything owner-only stay in the app.
//
//	version: 1
//	notifications:
//	  needs-input: true
//	  failed: true
//	  review: false
//	  dock-badge: true
//	  sound-needs-you: true
//	  sound-done: false
//
// What the file leaves out is the default.

// NotificationFields maps the file's names to the app's (NotificationPreferences).
var NotificationFields = map[string]string{
	"needs-input":     "needsInput",
	"failed":          "failed",
	"review":          "review",
	"dock-badge":      "badge",
	"sound-needs-you": "soundNeedsYou",
	"sound-done":      "soundDone",
}

// notificationOrder is the order the schema and the writer use.
var notificationOrder = []string{"needs-input", "failed", "review", "dock-badge", "sound-needs-you", "sound-done"}

// Settings is what settings.yaml declares: only the values it sets.
type Settings struct {
	Notifications map[string]bool `json:"notifications"`
}

// ParseSettings reads settings.yaml.
func ParseSettings(data []byte) (Settings, []Issue, error) {
	out := Settings{Notifications: map[string]bool{}}
	root, err := parseRoot(data, "the file must be a mapping with version and notifications")
	if err != nil || root == nil {
		return out, nil, err
	}
	p := &parser{}
	for key, value := range pairs(root) {
		switch key.Value {
		case "version":
			if value.Value != "1" {
				p.fail(value, "version", "only version 1 exists")
			}
		case "notifications":
			if value.Tag == "!!null" {
				continue
			}
			if value.Kind != yaml.MappingNode {
				p.fail(value, "notifications", "notifications is a mapping of %v to true or false", notificationOrder)
				continue
			}
			for field, v := range pairs(value) {
				at := "notifications." + field.Value
				name, ok := NotificationFields[field.Value]
				if !ok {
					p.fail(field, at, "unknown setting %q%s", field.Value, didYouMean(field.Value, notificationOrder))
					continue
				}
				p.failed = false
				on := p.boolean(v, at)
				if !p.failed {
					out.Notifications[name] = on
				}
			}
		default:
			p.warn(key, key.Value, "unknown section %q is ignored (expected version, notifications)%s", key.Value, didYouMean(key.Value, []string{"version", "notifications"}))
		}
	}
	return out, p.issues, nil
}
