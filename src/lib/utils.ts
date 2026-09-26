import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import React from "react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// URL pattern for matching URLs in text
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]（）]+)/g;

// Convert text with URLs to React elements with clickable links
export function linkifyText(text: string): React.ReactNode {
  if (!text) return text;

  const parts = text.split(URL_REGEX);

  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) => {
    if (URL_REGEX.test(part)) {
      // Reset regex lastIndex
      URL_REGEX.lastIndex = 0;
      return React.createElement('a', {
        key: index,
        href: part,
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'text-blue-600 hover:text-blue-800 underline break-all',
      }, part);
    }
    return part;
  });
}
