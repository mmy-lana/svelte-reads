export const ValidationRules = {
  user: {
    handle: {
      regex: /^[a-zA-Z0-9_]{3,20}$/,
      message: 'Handle must be between 3 and 20 alphanumeric characters or underscores.'
    },
    displayName: {
      minLength: 2,
      maxLength: 50
    },
    bio: {
      maxLength: 500
    }
  },
  book: {
    isbn13: {
      regex: /^(978|979)\d{10}$/,
      message: 'Must be a valid 13-digit standard ISBN.'
    }
  },
  review: {
    rating: {
      min: 0.5,
      max: 5.0,
      step: 0.5
    },
    title: {
      minLength: 2,
      maxLength: 120
    },
    content: {
      minLength: 20,
      maxLength: 10000
    }
  },
  shelf: {
    progressPages: (pageCount: number) => ({
      min: 0,
      max: pageCount
    })
  }
} as const;

export function validateRating(val: number): boolean {
  return val >= 0.5 && val <= 5.0 && (val * 2) % 1 === 0;
}

export function validateProgress(current: number, total: number): { valid: boolean; percentage: number } {
  const boundedCurrent = Math.max(0, Math.min(current, total));
  const percentage = total > 0 ? Math.round((boundedCurrent / total) * 100) : 0;
  return {
    valid: current >= 0 && current <= total,
    percentage
  };
}
