import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a URL string to ensure it is valid.
 * @param input - The URL string to format.
 * @returns The formatted URL string.
 */
export function formatUrl(input: string): string {
  try {
    new URL(input);
    return input;
  } catch {
    try {
      if (input.includes("localhost")) {
        return `http://${input}`;
      }
      const urlWithProtocol = `https://${input}`;
      new URL(urlWithProtocol);
      return urlWithProtocol;
    } catch {
      throw new Error(`Invalid URL: ${input}`);
    }
  }
}

