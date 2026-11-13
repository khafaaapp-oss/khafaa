/**
 * Validates req.body against a Zod schema.
 * On failure: 400 with details.
 * On success: replaces req.body with the parsed (safe) data.
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten(),
      });
    }
    req.body = result.data;
    next();
  };
}
