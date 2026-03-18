// Built-in rule set templates for the marketplace

export type RuleTemplate = {
  id: string;
  name: string;
  description: string;
  category: 'react' | 'go' | 'security' | 'python' | 'performance';
  rules: Array<{
    name: string;
    prompt: string;
    severity: 'error' | 'warning' | 'info';
    category: 'style' | 'security' | 'architecture' | 'performance' | 'maintainability';
    weight: number;
  }>;
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'react-best-practices',
    name: 'React Best Practices',
    description: 'Hooks rules, component patterns, performance, and accessibility best practices for React applications.',
    category: 'react',
    rules: [
      {
        name: 'Hooks rules compliance',
        prompt: 'Check that React hooks are only called at the top level of function components or custom hooks. Hooks must not be called inside loops, conditions, or nested functions.',
        severity: 'error',
        category: 'architecture',
        weight: 90,
      },
      {
        name: 'Missing key prop in lists',
        prompt: 'Check that every element rendered in a list (using .map()) has a unique key prop. Using array index as key when items can be reordered is also an issue.',
        severity: 'warning',
        category: 'performance',
        weight: 80,
      },
      {
        name: 'useEffect dependency array',
        prompt: 'Check that useEffect hooks include all variables, functions, and state referenced in the effect in their dependency array. Missing dependencies cause stale closure bugs.',
        severity: 'warning',
        category: 'maintainability',
        weight: 85,
      },
      {
        name: 'Component accessibility',
        prompt: 'Check that interactive elements (buttons, links, inputs) have proper aria-label, alt text for images, and semantic HTML. Ensure forms have labels associated with inputs.',
        severity: 'warning',
        category: 'style',
        weight: 70,
      },
      {
        name: 'Avoid inline function creation in render',
        prompt: 'Check for expensive computations or large object/array literals created inline in JSX that could be memoized with useMemo or useCallback to avoid unnecessary re-renders.',
        severity: 'info',
        category: 'performance',
        weight: 60,
      },
      {
        name: 'Props mutation',
        prompt: 'Check that component props are never mutated directly. Props are read-only and mutations should be avoided; use state or callbacks instead.',
        severity: 'error',
        category: 'architecture',
        weight: 95,
      },
    ],
  },
  {
    id: 'go-best-practices',
    name: 'Go Best Practices',
    description: 'Error handling, goroutine safety, idiomatic Go patterns, and common pitfalls.',
    category: 'go',
    rules: [
      {
        name: 'Error handling',
        prompt: 'Check that errors returned from functions are always checked and not silently discarded with underscore. Every error should be handled or explicitly propagated with context.',
        severity: 'error',
        category: 'maintainability',
        weight: 95,
      },
      {
        name: 'Goroutine leaks',
        prompt: 'Check for goroutines that may never terminate due to missing cancellation, select without default, or channels that are never closed. Look for goroutines spawned in loops without proper lifecycle management.',
        severity: 'error',
        category: 'performance',
        weight: 90,
      },
      {
        name: 'Context propagation',
        prompt: 'Check that context.Context is properly passed as the first argument to functions that perform I/O, network calls, or long-running operations. Avoid using context.Background() deep in call stacks.',
        severity: 'warning',
        category: 'architecture',
        weight: 80,
      },
      {
        name: 'Mutex usage',
        prompt: 'Check that mutexes are unlocked with defer immediately after locking. Check for potential deadlocks where a mutex is locked multiple times without unlocking.',
        severity: 'error',
        category: 'security',
        weight: 90,
      },
      {
        name: 'Idiomatic naming',
        prompt: 'Check that exported identifiers follow Go naming conventions (PascalCase), unexported use camelCase, and interfaces are named with -er suffix. Abbreviations like ID, URL should be all caps.',
        severity: 'info',
        category: 'style',
        weight: 50,
      },
      {
        name: 'Slice and map initialization',
        prompt: 'Check that slices and maps are initialized with appropriate capacity when the size is known. Using make with capacity avoids repeated memory allocations in loops.',
        severity: 'info',
        category: 'performance',
        weight: 60,
      },
    ],
  },
  {
    id: 'security-owasp',
    name: 'Security (OWASP Top 10)',
    description: 'Injection, XSS, authentication, secrets exposure, and other OWASP Top 10 vulnerabilities.',
    category: 'security',
    rules: [
      {
        name: 'SQL injection',
        prompt: 'Check for SQL queries constructed by concatenating user input or variables directly into query strings. All dynamic values should use parameterized queries or prepared statements.',
        severity: 'error',
        category: 'security',
        weight: 100,
      },
      {
        name: 'Hardcoded secrets and credentials',
        prompt: 'Check for hardcoded passwords, API keys, tokens, private keys, or connection strings in the code. These should be loaded from environment variables or a secrets manager.',
        severity: 'error',
        category: 'security',
        weight: 100,
      },
      {
        name: 'Cross-site scripting (XSS)',
        prompt: 'Check for places where user-provided data is rendered directly in HTML without proper escaping or sanitization. Look for dangerouslySetInnerHTML in React, innerHTML, or template literals inserted into DOM.',
        severity: 'error',
        category: 'security',
        weight: 95,
      },
      {
        name: 'Authentication and session management',
        prompt: 'Check that passwords are hashed using bcrypt, argon2, or scrypt (not MD5 or SHA1). Session tokens should be sufficiently random and properly invalidated on logout.',
        severity: 'error',
        category: 'security',
        weight: 95,
      },
      {
        name: 'Path traversal',
        prompt: 'Check for file operations that use user-supplied paths without sanitization. User input used in file paths should be validated and constrained to allowed directories.',
        severity: 'error',
        category: 'security',
        weight: 90,
      },
      {
        name: 'Sensitive data in logs',
        prompt: 'Check for logging statements that may output sensitive data such as passwords, tokens, credit card numbers, or personal information.',
        severity: 'warning',
        category: 'security',
        weight: 80,
      },
      {
        name: 'Dependency vulnerabilities',
        prompt: 'Check if the code imports packages known to have security issues or uses outdated versions of security-critical libraries.',
        severity: 'warning',
        category: 'security',
        weight: 75,
      },
    ],
  },
  {
    id: 'python-best-practices',
    name: 'Python Best Practices',
    description: 'Type hints, error handling, packaging standards, and Pythonic patterns.',
    category: 'python',
    rules: [
      {
        name: 'Type annotations',
        prompt: 'Check that function signatures include type annotations for parameters and return values. Use typing module types for complex types (List, Dict, Optional, etc.).',
        severity: 'info',
        category: 'maintainability',
        weight: 60,
      },
      {
        name: 'Bare except clauses',
        prompt: 'Check for bare "except:" clauses that catch all exceptions including SystemExit and KeyboardInterrupt. Exceptions should be caught specifically.',
        severity: 'warning',
        category: 'maintainability',
        weight: 80,
      },
      {
        name: 'Mutable default arguments',
        prompt: 'Check for function definitions that use mutable objects (lists, dicts, sets) as default parameter values. This is a common Python pitfall that causes shared state across calls.',
        severity: 'error',
        category: 'architecture',
        weight: 85,
      },
      {
        name: 'Resource management',
        prompt: 'Check that file handles, database connections, and other resources are properly closed using context managers (with statement) rather than relying on manual close() calls.',
        severity: 'warning',
        category: 'maintainability',
        weight: 75,
      },
      {
        name: 'f-string usage',
        prompt: 'Check that modern f-strings are used for string formatting instead of % formatting or .format() where Python 3.6+ is supported. f-strings are more readable and performant.',
        severity: 'info',
        category: 'style',
        weight: 40,
      },
    ],
  },
  {
    id: 'performance',
    name: 'Performance',
    description: 'N+1 queries, memory leaks, blocking I/O, caching opportunities, and algorithmic inefficiencies.',
    category: 'performance',
    rules: [
      {
        name: 'N+1 database queries',
        prompt: 'Check for N+1 query patterns where a query is executed inside a loop. These should be replaced with batch queries, JOINs, or eager loading.',
        severity: 'error',
        category: 'performance',
        weight: 90,
      },
      {
        name: 'Memory leaks',
        prompt: 'Check for patterns that may cause memory leaks: event listeners not removed, timers not cleared, circular references, or large objects kept in scope indefinitely.',
        severity: 'warning',
        category: 'performance',
        weight: 85,
      },
      {
        name: 'Blocking I/O in async context',
        prompt: 'Check for synchronous/blocking I/O operations (file reads, network calls, sleep) inside async functions or event handlers where async alternatives should be used.',
        severity: 'warning',
        category: 'performance',
        weight: 80,
      },
      {
        name: 'Missing pagination',
        prompt: 'Check for database queries or API calls that fetch unbounded result sets without LIMIT or pagination. Large result sets can cause memory and performance issues.',
        severity: 'warning',
        category: 'performance',
        weight: 75,
      },
      {
        name: 'Inefficient algorithms',
        prompt: 'Check for O(n²) or worse algorithms where more efficient alternatives exist: nested loops over large collections, repeated linear searches that could use maps/sets, or unnecessary sorting.',
        severity: 'info',
        category: 'performance',
        weight: 70,
      },
      {
        name: 'Missing caching for expensive operations',
        prompt: 'Check for expensive computations, external API calls, or database queries that are called repeatedly with the same inputs and could benefit from caching or memoization.',
        severity: 'info',
        category: 'performance',
        weight: 60,
      },
    ],
  },
];
