package engine

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/AntoineToussaint/lazybox/v2/internal/agent"
	"github.com/AntoineToussaint/lazybox/v2/internal/runner/journal"
)

type accepted struct {
	fingerprint [32]byte
	receipt     agent.Receipt
	// adopted: accepted by an earlier Runner, whose fingerprint was not kept.
	adopted bool
}
type Snapshot struct {
	Title string `json:"title,omitempty"`
	// Opening is the conversation's first message, bounded: what a generated
	// title and the fallback title are made from.
	Opening      string             `json:"opening,omitempty"`
	Purpose      string             `json:"purpose"`
	ID           string             `json:"id"`
	Profile      string             `json:"profile"`
	Reference    string             `json:"reference"`
	GatewayID    string             `json:"gatewayId,omitempty"`
	Capabilities agent.Capabilities `json:"capabilities"`
	Busy         bool               `json:"busy"`
	Closed       bool               `json:"closed"`
	Fault        string             `json:"fault,omitempty"`
	Queued       int                `json:"queued"`
	// QueuedMessages are the messages waiting for the turn in progress.
	QueuedMessages    []QueuedMessage           `json:"queuedMessages,omitempty"`
	Pending           map[string]agent.Event    `json:"pending"`
	Status            agent.Status              `json:"status"`
	Agents            map[string]agent.Activity `json:"agents"`
	Account           *agent.AccountObservation `json:"account,omitempty"`
	ActivityTruncated bool                      `json:"activityTruncated"`
	// LastMessage is the tail of the main agent's latest message.
	LastMessage string `json:"lastMessage,omitempty"`
}

// QueuedMessage is a message accepted while the agent was busy.
type QueuedMessage struct {
	OperationID string    `json:"operationId"`
	Text        string    `json:"text"`
	QueuedAt    time.Time `json:"queuedAt,omitzero"`
	// Origin marks a message Lazybox wrote (agent.Origin).
	Origin *agent.Origin `json:"origin,omitempty"`
}

// openingLimit bounds the first message a snapshot keeps (Snapshot.Opening).
const openingLimit = 2000

// queuedPreview bounds a queued message's text in a snapshot.
const queuedPreview = 280

type Engine struct {
	responses map[string]bool
	// replayed holds events already recorded from a native line the previous
	// Runner recorded only in part; the replayed line must not record them twice.
	replayed map[string]int
	// replayedAfter is the last line the previous Runner recorded whole: the
	// replay ends with the first complete line after it, or a new native session.
	replayedAfter uint64
	mu            sync.Mutex
	opMu          sync.Mutex
	provider      agent.Session
	journal       *journal.Journal
	ctx           context.Context
	cancel        context.CancelFunc
	state         Snapshot
	queue         []agent.Operation
	ops           map[string]accepted
	done          chan struct{}
	closeOnce     sync.Once
	closeErr      error
	capture       func(Snapshot, json.RawMessage) error
	// durable records what a later Runner needs to re-attach; nil disables it.
	durable     func(Attachment) error
	lastDurable []byte
	detaching   bool
	detachOnce  sync.Once
	detachErr   error
	// messageOpen is whether the next main-agent delta continues LastMessage.
	messageOpen bool
	// hooks observe the main agent's turns; turnOp is the message whose turn
	// is running, or "" when it began before this engine (an adopted turn).
	hooks  TurnHooks
	turnOp string
	// queuedAt is when each queued message was accepted.
	queuedAt map[string]time.Time
}

// TurnHooks observe the main agent's turns, for code checkpoints.
type TurnHooks struct {
	// Before runs before a message is delivered, once its turn is marked
	// busy. The delivery waits for it, so it must be bounded.
	Before func(op agent.Operation)
	// After runs once the turn ended, off the event path. operation is the
	// message that started it, or "" for a turn started before this engine.
	After func(operation string, ended time.Time)
}

// SetTurnHooks installs h for every later turn.
func (e *Engine) SetTurnHooks(h TurnHooks) {
	e.mu.Lock()
	e.hooks = h
	e.mu.Unlock()
}

func New(ctx context.Context, adapter agent.Adapter, open agent.Open, spool *journal.Journal) (*Engine, error) {
	return NewPersisted(ctx, adapter, open, spool, nil)
}

// NewPersisted commits observed state through an injected durable recorder.
func NewPersisted(ctx context.Context, adapter agent.Adapter, open agent.Open, spool *journal.Journal, capture func(Snapshot, json.RawMessage) error) (*Engine, error) {
	return NewDurable(ctx, adapter, open, spool, capture, nil)
}

// NewDurable also records an Attachment after every change, so a later Runner
// can re-attach to the live native process with Adopt.
func NewDurable(ctx context.Context, adapter agent.Adapter, open agent.Open, spool *journal.Journal, capture func(Snapshot, json.RawMessage) error, durable func(Attachment) error) (*Engine, error) {
	life, cancel := context.WithCancel(ctx)
	s, err := adapter.Open(life, open)
	if err != nil {
		cancel()
		return nil, err
	}
	e := &Engine{capture: capture, durable: durable, provider: s, journal: spool, ctx: life, cancel: cancel, ops: map[string]accepted{}, responses: map[string]bool{}, done: make(chan struct{}), state: Snapshot{ID: open.ID, Purpose: open.Purpose, Profile: open.Profile, Reference: s.Reference(), Capabilities: s.Capabilities(), Pending: map[string]agent.Event{}}}
	if open.Gateway != nil {
		e.state.GatewayID = open.Gateway.ID
	}
	e.state.Agents = map[string]agent.Activity{"root": {ID: "root", Name: "Main agent", Kind: "agent", Status: agent.Starting, UpdatedAt: time.Now().UTC()}}
	if spool.Count() != 0 {
		cancel()
		s.Close()
		return nil, errors.New("session journal already exists; use a new execution identity and explicit provider resume")
	}
	if _, err = spool.Append(map[string]any{"type": "session_opened", "session": e.state}); err != nil {
		cancel()
		s.Close()
		return nil, err
	}
	if err = e.persistLocked(); err != nil {
		cancel()
		s.Close()
		return nil, err
	}
	go e.receive()
	return e, nil
}

func (e *Engine) Snapshot() Snapshot {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.snapshotLocked()
}
func (e *Engine) snapshotLocked() Snapshot {
	s := e.state
	s.Queued = len(e.queue)
	s.QueuedMessages = nil
	for _, op := range e.queue {
		if op.Kind != agent.Message {
			continue
		}
		text := []rune(op.Text)
		if len(text) > queuedPreview {
			text = append(text[:queuedPreview-1], '…')
		}
		s.QueuedMessages = append(s.QueuedMessages, QueuedMessage{OperationID: op.ID, Text: string(text), QueuedAt: e.queuedAt[op.ID], Origin: op.Origin})
	}
	s.Pending = map[string]agent.Event{}
	for k, v := range e.state.Pending {
		s.Pending[k] = v
	}
	s.Agents = map[string]agent.Activity{}
	for id, activity := range e.state.Agents {
		s.Agents[id] = activity
	}
	if e.state.Account != nil {
		value := *e.state.Account
		value.Windows = append([]agent.UsageWindow(nil), value.Windows...)
		s.Account = &value
	}
	s.Status = snapshotStatus(s)
	return s
}

func validate(op agent.Operation, c agent.Capabilities) error {
	if op.ID == "" || len(op.ID) > 128 {
		return errors.New("operation id required (max 128 bytes)")
	}
	switch op.Kind {
	case agent.Message, agent.Steer:
		if op.Text == "" && len(op.Images) == 0 && len(op.Files) == 0 {
			return errors.New("empty message")
		}
		if len(op.Text) > 1<<20 || len(op.Images) > 4 {
			return errors.New("message exceeds limits")
		}
		for _, img := range op.Images {
			if len(img.Data) > 8<<20 || (img.MediaType != "image/png" && img.MediaType != "image/jpeg" && img.MediaType != "image/webp" && img.MediaType != "image/gif") {
				return errors.New("invalid image")
			}
		}
		if len(op.Images) > 0 && !c.Images {
			return agent.ErrUnsupported
		}
		if len(op.Files) > 4 {
			return errors.New("too many attached files")
		}
		if len(op.Files) > 0 && !c.Files {
			return agent.ErrUnsupported
		}
		if op.Kind == agent.Steer && !c.Steer {
			return agent.ErrUnsupported
		}
		if len(op.Context) > 128<<10 {
			return errors.New("instruction update exceeds limits")
		}
	case agent.Permission:
		if !c.LivePermission {
			return agent.ErrUnsupported
		}
		if !agent.PermissionModes[op.Permission] {
			return errors.New("permission must be ask, read-only or yolo")
		}
	case agent.Model:
		if !c.LiveModel {
			return agent.ErrUnsupported
		}
		if err := agent.ValidModel(op.Model); err != nil {
			return err
		}
	case agent.Interrupt:
	case agent.StopAgent:
		if !c.StopAgent {
			return agent.ErrUnsupported
		}
		if op.AgentID == "" || op.AgentID == "root" || len(op.AgentID) > 256 {
			return errors.New("sub-agent id required")
		}
	case agent.Answer:
		if !c.Questions {
			return agent.ErrUnsupported
		}
		if op.RequestID == "" {
			return errors.New("request id required")
		}
	case agent.Approve:
		if !c.Approvals {
			return agent.ErrUnsupported
		}
		if op.RequestID == "" || (op.Decision != "accept" && op.Decision != "decline" && op.Decision != "cancel") {
			return errors.New("invalid approval")
		}
		if (op.Always != "" && op.Decision != "accept") || (op.Reason != "" && op.Decision == "accept") || len(op.Always) > 256 || len(op.Reason) > 4096 {
			return errors.New("invalid approval: always goes with accept, a reason with decline")
		}
	default:
		return agent.ErrUnsupported
	}
	return nil
}

// Apply accepts once under an operation identity. Message queueing is generic;
// delivery uses the engine lifetime rather than the caller's RPC lifetime.
func (e *Engine) Apply(ctx context.Context, op agent.Operation) (agent.Receipt, error) {
	if err := ctx.Err(); err != nil {
		return agent.Receipt{}, err
	}
	e.opMu.Lock()
	defer e.opMu.Unlock()
	op.Origin = op.Origin.Bounded()
	// The attached instruction update is decided by the Runner, not the client,
	// so a client retrying the same operation is recognized without it.
	identity := op
	identity.Context = ""
	b, _ := json.Marshal(identity)
	fingerprint := sha256.Sum256(b)
	e.mu.Lock()
	if old, ok := e.ops[op.ID]; ok {
		e.mu.Unlock()
		if !old.adopted && old.fingerprint != fingerprint {
			return agent.Receipt{}, errors.New("operation id reused with different content")
		}
		return old.receipt, nil
	}
	// A message sent while a subscription is at its limit waits in the queue:
	// it is delivered, once, when the conversation continues on another
	// subscription or after the reset.
	// After a provider error ends a turn, the next message continues the
	// conversation (and clears the error); nothing else may run before it.
	if e.state.Closed || (e.state.Fault != "" && !(op.Kind == agent.Message && (agent.LimitFault(e.state.Fault) || agent.TurnFault(e.state.Fault)))) {
		e.mu.Unlock()
		return agent.Receipt{}, errors.New("session is closed or faulted")
	}
	if err := validate(op, e.state.Capabilities); err != nil {
		e.mu.Unlock()
		return agent.Receipt{}, err
	}
	if len(e.ops) >= 4096 || len(e.queue) >= 64 {
		e.mu.Unlock()
		return agent.Receipt{}, errors.New("session operation/queue capacity exhausted")
	}
	if op.Kind == agent.Answer || op.Kind == agent.Approve {
		pending, ok := e.state.Pending[op.RequestID]
		if !ok || e.responses[op.RequestID] || (op.Kind == agent.Answer && pending.Type != "question") || (op.Kind == agent.Approve && pending.Type != "approval") {
			e.mu.Unlock()
			return agent.Receipt{}, errors.New("request is absent, resolved, or of another kind")
		}
	}
	if (op.Kind == agent.Interrupt || op.Kind == agent.Steer) && !e.state.Busy {
		e.mu.Unlock()
		return agent.Receipt{}, errors.New("no active turn")
	}
	if op.Kind == agent.StopAgent {
		// A sub-agent can outlive its parent's turn (a background task), so
		// this needs the agent running, not the session busy.
		child, ok := e.state.Agents[op.AgentID]
		if !ok || child.NativeID == "" || stoppedStatus(child.Status) {
			e.mu.Unlock()
			return agent.Receipt{}, errors.New("sub-agent is not running")
		}
		op.NativeID = child.NativeID
	}
	r := agent.Receipt{ID: op.ID, Delivery: "accepted"}
	if op.Kind == agent.Message && e.state.Title == "" {
		title := []rune(strings.TrimSpace(strings.SplitN(op.Text, "\n", 2)[0]))
		if len(title) > 80 {
			title = title[:80]
		}
		e.state.Title = string(title)
		opening := []rune(strings.TrimSpace(op.Text))
		if len(opening) > openingLimit {
			opening = opening[:openingLimit]
		}
		e.state.Opening = string(opening)
	}
	// Do not retain image bytes or credentials in journal events.
	record := map[string]any{"type": "operation_accepted", "operationId": op.ID, "kind": op.Kind, "text": op.Text, "imageCount": len(op.Images), "requestId": op.RequestID, "data": map[string]any{"files": op.Files}}
	// A response's decision and answers are journaled so a request redelivered
	// after a restart can be answered as the user did.
	if op.Decision != "" {
		record["decision"] = op.Decision
	}
	// A message Lazybox wrote says so, for clients to show it as an event of
	// the conversation rather than as the person's words.
	if op.Kind == agent.Message && op.Origin != nil {
		record["data"] = map[string]any{"files": op.Files, "origin": op.Origin}
	}
	if op.AgentID != "" {
		record["agentId"] = op.AgentID
	}
	if op.Always != "" {
		record["always"] = op.Always
	}
	if op.Reason != "" {
		record["reason"] = op.Reason
	}
	if len(op.Answers) > 0 {
		record["answers"] = op.Answers
	}
	// Clients read the response from the event's data: the conversation
	// shows what was answered, and which "always" was granted.
	if op.Kind == agent.Answer || op.Kind == agent.Approve {
		record["data"] = map[string]any{"files": op.Files, "response": map[string]any{"kind": op.Kind, "decision": op.Decision, "always": op.Always, "reason": op.Reason, "answers": op.Answers}}
	}
	if !e.appendLocked(record) {
		e.mu.Unlock()
		return r, errors.New("journal unavailable")
	}
	e.ops[op.ID] = accepted{fingerprint: fingerprint, receipt: r}
	if op.Kind == agent.Message {
		if agent.TurnFault(e.state.Fault) {
			e.state.Fault = ""
		}
		e.queue = append(e.queue, op)
		if e.queuedAt == nil {
			e.queuedAt = map[string]time.Time{}
		}
		e.queuedAt[op.ID] = time.Now()
		e.persistDurableLocked()
		e.mu.Unlock()
		go e.dispatch()
		return r, nil
	}
	if op.Kind == agent.Answer || op.Kind == agent.Approve {
		e.responses[op.RequestID] = true
	}
	e.mu.Unlock()
	r, err := e.provider.Apply(e.ctx, op)
	r.ID = op.ID
	if err != nil {
		r.Delivery = "failed"
		r.Error = err.Error()
	}
	e.mu.Lock()
	e.ops[op.ID] = accepted{fingerprint: fingerprint, receipt: r}
	if errors.Is(err, agent.ErrUnsupported) {
		delete(e.responses, op.RequestID)
	}
	e.appendLocked(map[string]any{"type": "receipt", "receipt": r})
	// A local submission is not request resolution: only the adapter's
	// correlated event can remove the pending request from the registry.
	e.mu.Unlock()
	return r, err
}

// Ways DeliverQueued delivers a queued message.
const (
	// DeliverNow interrupts the turn in progress; the message is the next turn.
	DeliverNow = "now"
	// DeliverSteer sends the message into the running turn (Capabilities.Steer).
	DeliverSteer = "steer"
)

// ErrNotQueued means the message is no longer waiting: it was delivered, or
// the turn ended and it started its own.
var ErrNotQueued = errors.New("that message is no longer queued")

// DeliverQueued delivers a queued message ahead of its turn. DeliverNow moves
// it to the head of the queue and interrupts the running turn, so it is the
// next turn; with no turn running it is dispatched at once. DeliverSteer takes
// it out of the queue and sends it into the running turn; if the provider
// refuses, it goes back to the head of the queue and the error is returned.
func (e *Engine) DeliverQueued(ctx context.Context, id, how string) (agent.Receipt, error) {
	if how != DeliverNow && how != DeliverSteer {
		return agent.Receipt{}, errors.New(`delivery must be "now" or "steer"`)
	}
	e.mu.Lock()
	at := -1
	for i, op := range e.queue {
		if op.ID == id && op.Kind == agent.Message {
			at = i
			break
		}
	}
	if at < 0 {
		e.mu.Unlock()
		return agent.Receipt{}, ErrNotQueued
	}
	if e.state.Closed || e.state.Fault != "" {
		e.mu.Unlock()
		return agent.Receipt{}, errors.New("session is closed or faulted")
	}
	op := e.queue[at]
	if how == DeliverSteer {
		if !e.state.Capabilities.Steer {
			e.mu.Unlock()
			return agent.Receipt{}, agent.ErrUnsupported
		}
		if !e.state.Busy {
			e.mu.Unlock()
			return agent.Receipt{}, errors.New("no active turn")
		}
		e.queue = append(e.queue[:at:at], e.queue[at+1:]...)
		queuedAt := e.queuedAt[op.ID]
		delete(e.queuedAt, op.ID)
		e.persistDurableLocked()
		e.mu.Unlock()
		e.opMu.Lock()
		steer := op
		steer.Kind = agent.Steer
		r, err := e.provider.Apply(e.ctx, steer)
		e.opMu.Unlock()
		r.ID = op.ID
		e.mu.Lock()
		if err != nil {
			// Not delivered: the message keeps its place, first in line.
			e.queue = append([]agent.Operation{op}, e.queue...)
			if !queuedAt.IsZero() {
				e.queuedAt[op.ID] = queuedAt
			}
			e.persistDurableLocked()
			e.mu.Unlock()
			go e.dispatch()
			return agent.Receipt{}, err
		}
		if r.Delivery == "" {
			r.Delivery = "accepted"
		}
		old := e.ops[op.ID]
		old.receipt = r
		e.ops[op.ID] = old
		e.appendLocked(map[string]any{"type": "receipt", "receipt": r})
		e.mu.Unlock()
		return r, nil
	}
	e.queue = append(append([]agent.Operation{op}, e.queue[:at]...), e.queue[at+1:]...)
	e.persistDurableLocked()
	busy := e.state.Busy
	e.mu.Unlock()
	if !busy {
		go e.dispatch()
		return agent.Receipt{ID: op.ID, Delivery: "accepted"}, nil
	}
	// The interrupt ends the turn; the dispatch that follows takes this message.
	r, err := e.Apply(ctx, agent.Operation{ID: op.ID[:min(len(op.ID), 120)] + ":now", Kind: agent.Interrupt})
	if err != nil {
		return r, err
	}
	return agent.Receipt{ID: op.ID, Delivery: "accepted"}, nil
}

func (e *Engine) dispatch() {
	e.opMu.Lock()
	defer e.opMu.Unlock()
	e.mu.Lock()
	if e.state.Busy || e.state.Closed || e.state.Fault != "" || len(e.queue) == 0 {
		e.mu.Unlock()
		return
	}
	op := e.queue[0]
	e.queue = e.queue[1:]
	delete(e.queuedAt, op.ID)
	e.persistDurableLocked()
	e.state.Busy = true
	e.observe(agent.Event{Type: "agent_status", Status: string(agent.Starting)})
	if op.Kind == agent.Answer || op.Kind == agent.Approve {
		e.responses[op.RequestID] = true
	}
	e.turnOp = op.ID
	before := e.hooks.Before
	e.mu.Unlock()
	if before != nil && op.Kind == agent.Message {
		before(op)
	}
	r, err := e.provider.Apply(e.ctx, op)
	r.ID = op.ID
	if err != nil {
		r.Delivery = "failed"
		r.Error = err.Error()
	}
	e.mu.Lock()
	if e.detaching {
		// The receipt is unknowable now; the adopting Runner records that.
		e.mu.Unlock()
		return
	}
	old := e.ops[op.ID]
	old.receipt = r
	e.ops[op.ID] = old
	e.appendLocked(map[string]any{"type": "receipt", "receipt": r})
	if err != nil {
		e.state.Busy = false
		e.state.Fault = "provider delivery failed; reconcile before continuing"
		e.observe(agent.Event{Type: "failure", Status: "delivery_failed"})
	}
	e.mu.Unlock()
}

func (e *Engine) appendLocked(value any) bool {
	if e.detaching {
		// The journal belongs to the next Runner now. Never fault or stop the
		// provider for a write that arrives after detaching.
		return false
	}
	_, err := e.journal.Append(value)
	if err == nil {
		err = e.persistLocked()
	}
	if err != nil {
		e.state.Fault = fmt.Sprintf("event capture failed: %v", err)
		e.cancel()
		go e.provider.Close()
		return false
	}
	return true
}

// endReplayLocked forgets what the previous Runner recorded of a line once
// that line is complete, or once a profile switch starts a new native session
// whose line numbers restart: a leftover must never match a new event.
func (e *Engine) endReplayLocked(ev agent.Event) {
	if e.replayed != nil && (ev.Type == "profile_changed" || (!ev.Partial && ev.Cursor > e.replayedAfter)) {
		e.replayed = nil
	}
}

func (e *Engine) receive() {
	defer close(e.done)
	for {
		ev, err := e.provider.Receive(e.ctx)
		if err != nil {
			e.mu.Lock()
			if !e.state.Closed && !e.detaching && e.ctx.Err() == nil {
				e.state.Fault = fmt.Sprintf("provider stream ended: %v", err)
				exit := agent.Event{Type: "process_exit", Status: "unknown", Text: err.Error()}
				e.observe(exit)
				e.appendLocked(exit)
			}
			e.mu.Unlock()
			return
		}
		e.mu.Lock()
		if key := agent.ReplayKey(ev); ev.Cursor != 0 && e.replayed[key] > 0 {
			e.replayed[key]--
			e.endReplayLocked(ev)
			e.mu.Unlock()
			e.commit(ev)
			continue
		}
		e.endReplayLocked(ev)
		rootEvent := ev.AgentID == "" || ev.AgentID == "root"
		if ev.SessionID != "" && rootEvent {
			e.state.Reference = ev.SessionID
		}
		switch ev.Type {
		case "profile_switching":
			for id, pending := range e.state.Pending {
				e.appendLocked(agent.Event{Type: "request_resolved", RequestID: id, AgentID: pending.AgentID, Status: "profile_switched"})
				delete(e.state.Pending, id)
			}
		case "turn_started":
			if rootEvent {
				e.state.Busy = true
			}
		case "turn_ended":
			if !rootEvent {
				break
			}
			e.state.Busy = false
			for id, pending := range e.state.Pending {
				if pending.AgentID == "" || pending.AgentID == "root" {
					e.appendLocked(agent.Event{Type: "request_resolved", RequestID: id, Status: "turn_ended"})
					delete(e.state.Pending, id)
				}
			}
		case "approval", "question":
			if _, known := e.state.Pending[ev.RequestID]; known && ev.RequestID != "" {
				// A request redelivered after re-attachment is already recorded.
				e.mu.Unlock()
				e.commit(ev)
				continue
			}
			if ev.RequestID == "" || len(e.state.Pending) >= 64 {
				e.state.Fault = "invalid or excessive pending provider requests"
				e.cancel()
			} else {
				e.state.Pending[ev.RequestID] = ev
			}
		case "request_resolved":
			if pending, ok := e.state.Pending[ev.RequestID]; ok {
				ev.AgentID = pending.AgentID
			}
			delete(e.state.Pending, ev.RequestID)
		case "profile_changed":
			// A checkpoint or a retry delivered now is a turn: queued messages
			// wait for it. Otherwise the next queued message carries it.
			if rootEvent && ev.Status != "checkpoint_next_message" {
				e.state.Busy = true
			}
		case "failure":
			if !rootEvent {
				break
			}
			if e.state.Fault == "" || (ev.Status != "unknown" && ev.Status != "provider_error" && ev.Status != "") {
				e.state.Fault = ev.Status
			}
			if e.state.Fault == "" {
				e.state.Fault = "provider_failure"
			}
		}
		e.recordMessage(ev)
		e.observe(ev)
		ok := e.appendLocked(ev)
		var after func(string, time.Time)
		turn := ""
		if ev.Type == "turn_ended" && rootEvent {
			after, turn, e.turnOp = e.hooks.After, e.turnOp, ""
		}
		e.mu.Unlock()
		if !ok {
			return
		}
		e.commit(ev)
		if (ev.Type == "turn_ended" || ev.Type == "profile_changed") && rootEvent {
			if ev.Type == "turn_ended" && after != nil {
				go after(turn, time.Now().UTC())
			}
			go e.dispatch()
		}
	}
}

func (e *Engine) Events(ctx context.Context, cursor uint64) (journal.Record, error) {
	return e.journal.Next(ctx, cursor)
}

func (e *Engine) Close() error {
	e.mu.Lock()
	detached := e.detaching
	e.mu.Unlock()
	if detached {
		// The native process belongs to whichever Runner adopts it next.
		return e.detachErr
	}
	e.closeOnce.Do(func() {
		e.mu.Lock()
		e.state.Closed = true
		previousFault := e.state.Fault
		e.state.Fault = "native_exit_unconfirmed"
		e.mu.Unlock()
		e.closeErr = e.provider.Close()
		e.cancel()
		<-e.done
		// Provider calls have the canceled execution context now. Let their
		// final receipts settle before closing the journal under its readers.
		e.opMu.Lock()
		defer e.opMu.Unlock()
		e.mu.Lock()
		for _, op := range e.queue {
			e.appendLocked(agent.Event{Type: "receipt", OperationID: op.ID, Status: "canceled_before_delivery"})
		}
		e.queue = nil
		if e.closeErr == nil {
			e.state.Fault = previousFault
			e.observe(agent.Event{Type: "session_closed"})
		} else {
			e.observe(agent.Event{Type: "process_exit", Status: "unknown"})
		}
		e.appendLocked(agent.Event{Type: "session_closed", Status: "connection_closed_pending_requests_not_restored"})
		e.mu.Unlock()
		_ = e.journal.Close()
	})
	return e.closeErr
}

// Settings returns only the provider-owned execution policy, never credentials.
func (e *Engine) Settings() json.RawMessage {
	if runtime, ok := e.provider.(agent.RuntimeSettings); ok {
		return runtime.SessionSettings()
	}
	return nil
}
func (e *Engine) persistLocked() error {
	if e.capture != nil {
		if err := e.capture(e.snapshotLocked(), e.Settings()); err != nil {
			return err
		}
	}
	return e.persistDurableLocked()
}

// SwitchProfile continues the conversation on another subscription of its
// provider, or on the same one after its limit reset. It is refused for an
// ended conversation and for a fault other than an account limit, which must
// be reconciled first. Delivery waits for the switch: nothing queued reaches
// the old subscription once it begins.
func (e *Engine) SwitchProfile(id string) error {
	e.opMu.Lock()
	defer e.opMu.Unlock()
	e.mu.Lock()
	state := e.state
	detaching := e.detaching
	e.mu.Unlock()
	switch {
	case state.Closed || detaching:
		return errors.New("the conversation has ended; resume it to continue")
	case state.Fault != "" && !agent.LimitFault(state.Fault):
		return errors.New("the conversation must be reconciled before it can continue: " + state.Fault)
	case state.Agents["root"].Status == agent.Switching:
		return errors.New("the conversation is already switching subscription")
	case id == state.Profile && state.Fault == "":
		// Retrying in place is for a request a limit interrupted, never a running turn.
		return errors.New("the conversation already uses this subscription")
	}
	switcher, ok := e.provider.(agent.ProfileSwitcher)
	if !ok {
		return agent.ErrUnsupported
	}
	// An interrupted or running request continues now; an idle conversation
	// hands over with the next message.
	return switcher.SwitchProfile(id, state.Fault != "" || state.Busy)
}

// SetRotation replaces the subscriptions this conversation switches to
// automatically at a limit.
func (e *Engine) SetRotation(ids []string) error {
	switcher, ok := e.provider.(agent.ProfileSwitcher)
	if !ok {
		return agent.ErrUnsupported
	}
	return switcher.SetRotation(ids)
}

// Title asks the provider to name the conversation (agent.Titler). It runs
// beside the conversation: it neither waits for nor delays a turn.
func (e *Engine) Title(ctx context.Context, description string) (string, error) {
	return agent.TitleOf(ctx, e.provider, description)
}

// HostID is the session host running the provider's native process, or "".
func (e *Engine) HostID() string { return agent.HostOf(e.provider) }

// stoppedStatus reports whether an agent has finished and cannot be stopped.
func stoppedStatus(status agent.Status) bool {
	switch status {
	case agent.Done, agent.Failed, agent.Stopped, agent.Interrupted:
		return true
	}
	return false
}
