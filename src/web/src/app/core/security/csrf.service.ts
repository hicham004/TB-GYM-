import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';

@Injectable({ providedIn: 'root' })
export class CsrfService {
  private readonly api = inject(ApiClient);

  async refresh(): Promise<void> {
    await firstValueFrom(this.api.getCsrfToken());
  }
}
