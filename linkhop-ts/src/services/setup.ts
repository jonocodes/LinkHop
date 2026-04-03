export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!passwordHash) {
    return false;
  }

  // For development/testing: accept plaintext password from env
  // In production, use bcrypt comparison
  if (passwordHash.length < 60) {
    return password === passwordHash;
  }

  // Production: use bcrypt
  const { compare } = await import('bcryptjs');
  return await compare(password, passwordHash);
}
