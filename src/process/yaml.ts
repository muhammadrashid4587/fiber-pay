/**
 * Simple YAML serializer
 * Minimal implementation for config file generation
 */

export function stringify(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);
  
  if (obj === null || obj === undefined) {
    return 'null';
  }
  
  if (typeof obj === 'string') {
    // Quote strings that need it
    if (obj.includes(':') || obj.includes('#') || obj.includes('\n') || 
        obj.startsWith(' ') || obj.endsWith(' ') ||
        obj === '' || obj === 'true' || obj === 'false' ||
        !isNaN(Number(obj))) {
      return JSON.stringify(obj);
    }
    return obj;
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return '[]';
    }
    return obj
      .map((item) => {
        const value = stringify(item, indent + 1);
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          // Multi-line object in array
          const lines = value.split('\n');
          return `${spaces}- ${lines[0]}\n${lines.slice(1).map(l => spaces + '  ' + l).join('\n')}`;
        }
        return `${spaces}- ${value}`;
      })
      .join('\n');
  }
  
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) {
      return '{}';
    }
    return entries
      .map(([key, value]) => {
        const valueStr = stringify(value, indent + 1);
        if (typeof value === 'object' && value !== null && 
            !(Array.isArray(value) && value.length === 0) &&
            !(typeof value === 'object' && Object.keys(value).length === 0)) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        return `${spaces}${key}: ${valueStr}`;
      })
      .join('\n');
  }
  
  return String(obj);
}

export function parse(yaml: string): unknown {
  // Basic YAML parsing - for production use a proper library
  const lines = yaml.split('\n');
  const result: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown>; key?: string }> = [
    { indent: -1, obj: result },
  ];

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    const indent = line.search(/\S/);
    const content = line.trim();

    // Handle key: value
    const colonIndex = content.indexOf(':');
    if (colonIndex > 0) {
      const key = content.slice(0, colonIndex).trim();
      const value = content.slice(colonIndex + 1).trim();

      // Pop stack to correct level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const parent = stack[stack.length - 1].obj;

      if (value === '' || value === '|' || value === '>') {
        // Nested object
        const newObj: Record<string, unknown> = {};
        parent[key] = newObj;
        stack.push({ indent, obj: newObj, key });
      } else {
        // Primitive value
        parent[key] = parseValue(value);
      }
    }
  }

  return result;
}

function parseValue(value: string): unknown {
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Null
  if (value === 'null' || value === '~') return null;

  // Number
  const num = Number(value);
  if (!isNaN(num)) return num;

  // Array (inline)
  if (value.startsWith('[') && value.endsWith(']')) {
    return JSON.parse(value);
  }

  return value;
}
