# Claude Files - Documentation Index

This directory contains comprehensive documentation for the Vision Agent Chrome Extension, optimized for Claude Code agents and developers.

**Last Updated:** 2026-01-10

---

## Quick Start

**New to this project?** Start here:
1. Read `WORKFLOW.md` - Architecture overview
2. Follow setup in main `../README.md`
3. Test with `TESTING_GUIDE.md`
4. Debug with `HOW_TO_CHECK_ERRORS.md`

**Having issues?** Jump to:
- Screenshot errors → `SCREENSHOT_DEBUGGING.md`
- Rate limit errors → `RATE_LIMITING.md`
- Any error → `HOW_TO_CHECK_ERRORS.md`

---

## Documentation Files

### 📖 WORKFLOW.md
**Purpose:** Complete architecture and workflow documentation
**Audience:** Claude Code agents, developers
**Contents:**
- Project overview and capabilities
- File structure and responsibilities
- Data flow architecture with diagrams
- Technology stack details
- Error handling patterns
- API key management
- Action execution pipeline
- System prompts
- Development notes and troubleshooting

**When to use:**
- Understanding the codebase
- Planning modifications
- Onboarding new developers
- Reference for how components interact

---

### 🚦 RATE_LIMITING.md
**Purpose:** Rate limiting system guide
**Audience:** Developers, users experiencing rate limit errors
**Contents:**
- What happened (Gemini API rate limits)
- How rate limiting works
- Request tracking and rolling window
- Testing scenarios and examples
- How to upgrade API tier
- Monitoring usage
- FAQ and troubleshooting

**When to use:**
- Got "Please slow down" error
- Got "API rate limit" error
- Want to understand request quota
- Planning to upgrade API tier
- Testing heavily and hitting limits

---

### 🔍 SCREENSHOT_DEBUGGING.md
**Purpose:** Deep dive into screenshot capture debugging
**Audience:** Developers troubleshooting screenshot errors
**Contents:**
- Screenshot capture architecture
- All failure points explained
- Step-by-step debugging guide
- Console log examples (good vs bad)
- Advanced diagnostic commands
- Common error patterns with fixes
- All screenshot capture locations in code

**When to use:**
- Got "I couldn't see your screen" error
- Screenshot capture failing
- Need to debug Gemini Vision API issues
- Want to understand screenshot pipeline
- Adding new screenshot features

---

### ✅ TESTING_GUIDE.md
**Purpose:** Comprehensive testing scenarios
**Audience:** QA, developers, testers
**Contents:**
- 10+ detailed test scenarios
- Expected results for each test
- Common issues and solutions
- Performance benchmarks
- Test coverage checklist
- Success criteria
- Debugging tools guide

**When to use:**
- Testing the extension
- Verifying changes work
- QA before release
- Learning how features work
- Reproducing bugs

---

### 🛠️ HOW_TO_CHECK_ERRORS.md
**Purpose:** Quick guide to finding error logs
**Audience:** Anyone debugging issues
**Contents:**
- How to open service worker console
- How to open side panel console
- How to open content script console
- What to look for in each console
- Common error patterns
- How to share error info

**When to use:**
- Something isn't working
- Need to report a bug
- Want to see detailed logs
- Following other debugging guides
- Asked to "check the console"

---

## File Organization

```
claude_files/
├── README.md                    # This file - documentation index
├── WORKFLOW.md                  # Architecture and workflow (main doc)
├── RATE_LIMITING.md            # Rate limiting guide
├── SCREENSHOT_DEBUGGING.md     # Screenshot troubleshooting
├── TESTING_GUIDE.md            # Test scenarios and QA
└── HOW_TO_CHECK_ERRORS.md      # Console access guide
```

---

## Documentation Standards

All documentation in this directory follows these principles:

### 1. **Agent-Optimized**
- Clear section headers with keywords
- Code examples with context
- Explicit error messages
- Step-by-step procedures

### 2. **Searchable**
- ⭐ NEW/UPDATED markers for recent changes
- Consistent terminology
- Error messages quoted exactly as they appear
- Keyword-rich headings

### 3. **Actionable**
- Every problem has a fix
- Examples show expected vs actual behavior
- Links to relevant sections
- Console commands provided

### 4. **Maintainable**
- Last updated dates
- Version compatibility notes
- Change markers (⭐ NEW, ✅, etc.)
- Cross-references between files

---

## Common Tasks Quick Reference

### "I want to understand the architecture"
→ `WORKFLOW.md` - Start with Project Overview section

### "I'm getting an error"
→ `HOW_TO_CHECK_ERRORS.md` - Open correct console
→ Find error message in `SCREENSHOT_DEBUGGING.md` or `RATE_LIMITING.md`

### "I want to test my changes"
→ `TESTING_GUIDE.md` - Follow test scenarios

### "I'm hitting rate limits"
→ `RATE_LIMITING.md` - Complete guide to quotas and solutions

### "Screenshots aren't working"
→ `SCREENSHOT_DEBUGGING.md` - All failure points covered

### "I want to modify the code"
→ `WORKFLOW.md` - Development Notes for Claude Code Agents section

---

## Changelog

### 2026-01-10
- ✅ Added rate limiting system (client-side)
- ✅ Enhanced error handling with specific messages
- ✅ Added protected page detection
- ✅ Comprehensive logging system
- ✅ Service worker startup config loading
- 📝 Created `RATE_LIMITING.md`
- 📝 Created `SCREENSHOT_DEBUGGING.md`
- 📝 Created `TESTING_GUIDE.md`
- 📝 Created `HOW_TO_CHECK_ERRORS.md`
- 📝 Updated `WORKFLOW.md` with new features

### Initial Version
- 📝 Created `WORKFLOW.md`
- 📝 Documented architecture and data flow
- 📝 Documented all file responsibilities
- 📝 Added troubleshooting guide

---

## Contributing to Documentation

When adding or modifying features:

1. **Update WORKFLOW.md**
   - Add to relevant section
   - Mark with ⭐ NEW or ⭐ UPDATED
   - Update "Last Updated" date

2. **Update specialized guides if applicable**
   - Error patterns → Error handling sections
   - New APIs → Technology stack
   - New features → Testing guide

3. **Add cross-references**
   - Link related sections
   - Reference other docs when relevant

4. **Update this README.md**
   - Add to changelog
   - Update quick reference if needed

---

## Getting Help

If you can't find what you need in these docs:

1. **Search by error message** - Use Ctrl+F across all files
2. **Check console logs** - `HOW_TO_CHECK_ERRORS.md`
3. **Review similar sections** - Look at analogous features
4. **Check main README** - `../README.md` for user-facing info

---

## Document Relationships

```
README.md (this file)
    ↓ Index/Directory
    ↓
WORKFLOW.md
    ↓ Core architecture reference
    ├→ References RATE_LIMITING.md
    ├→ References SCREENSHOT_DEBUGGING.md
    └→ References other specialized docs
    ↓
Specialized Guides
    ├→ RATE_LIMITING.md (quota management)
    ├→ SCREENSHOT_DEBUGGING.md (vision features)
    ├→ TESTING_GUIDE.md (QA procedures)
    └→ HOW_TO_CHECK_ERRORS.md (debugging basics)
```

---

## Symbols Used

- ⭐ NEW - Recently added feature or section
- ⭐ UPDATED - Recently modified feature or section
- ✅ - Implemented enhancement
- ❌ - Known issue or limitation
- ⚠️ - Warning or important note
- 📝 - Documentation
- 🎉 - Success/completion
- 🔍 - Debugging/inspection
- 🚦 - Rate limiting/performance
- 🛠️ - Tools/utilities
- 📖 - Reference/guide

---

**All documentation files are git-ignored** - They are stored in `claude_files/` which is listed in `.gitignore` to avoid cluttering the repository with Claude-generated documentation.

---

**End of Documentation Index**
