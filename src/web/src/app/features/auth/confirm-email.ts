import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';

@Component({
  selector: 'app-confirm-email',
  imports: [RouterLink],
  templateUrl: './confirm-email.html',
  styleUrl: './auth.scss',
})
export class ConfirmEmail implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly route = inject(ActivatedRoute);

  protected readonly state = signal<'working' | 'success' | 'error'>('working');
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.confirm();
  }

  private async confirm(): Promise<void> {
    const userId = this.route.snapshot.queryParamMap.get('userId');
    const code = this.route.snapshot.queryParamMap.get('code');
    if (!userId || !code) {
      this.state.set('error');
      this.error.set($localize`This confirmation link is incomplete.`);
      return;
    }

    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.confirmEmail(userId, code));
      this.state.set('success');
    } catch (error) {
      this.state.set('error');
      this.error.set(
        apiErrorMessage(error, $localize`This confirmation link is invalid or expired.`),
      );
    }
  }
}
