import { compare } from 'bcryptjs';

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!passwordHash) {
    return false;
  }

  return await compare(password, passwordHash);
}
