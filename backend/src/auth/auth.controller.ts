import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

type LoginDto = { email?: string; password?: string };
type ChangePasswordDto = { currentPassword?: string; newPassword?: string };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.auth.login(body?.email ?? '', body?.password ?? '');
  }

  /** Changement de mot de passe de l'utilisateur connecté (dont 1re connexion). */
  @Post('change-password')
  changePassword(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() body: ChangePasswordDto,
  ) {
    return this.auth.changePassword(
      req.user?.sub ?? '',
      body?.currentPassword ?? '',
      body?.newPassword ?? '',
    );
  }

  /** Profil de l'utilisateur connecté (depuis le JWT). */
  @Get('me')
  me(@Req() req: Request & { user?: { sub?: string; email?: string; role?: string; name?: string } }) {
    const u = req.user ?? {};
    return { id: u.sub, email: u.email, role: u.role, name: u.name };
  }
}
