import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(200)
  async chat(@Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    const { reply, meta } = await this.chatService.chat(dto.message, dto.history ?? []);
    return { reply, meta };
  }

  /** Réponse en streaming (SSE) : le texte arrive token par token. */
  @Post('stream')
  async stream(@Body() dto: ChatRequestDto, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering nginx
    (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();

    const controller = new AbortController();
    let closed = false;
    res.on('close', () => {
      closed = true;
      controller.abort();
    });
    const send = (obj: unknown) => {
      if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    try {
      const { meta } = await this.chatService.chatStream(
        dto.message,
        dto.history ?? [],
        (token) => send({ type: 'token', value: token }),
        controller.signal,
      );
      send({ type: 'done', meta });
    } catch {
      send({ type: 'error', message: 'Erreur du service IA.' });
    } finally {
      if (!closed) res.end();
    }
  }
}
