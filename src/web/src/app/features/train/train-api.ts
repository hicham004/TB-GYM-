import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type {
  RegisterTraineeRequest,
  TraineeRegistrationResponse,
  TraineeSignUpStatusView,
} from '../../core/api/generated';
import { type TrainSignUp, toTrainSignUp } from './train.models';

const SIGN_UP = '/api/auth/register/trainee';

/**
 * TB Gym's own sign-up (notes plan N9a2, on N9a1's API): where it stands for this visit, and the form.
 * Both answer anyone, signed in or not; the server alone decides who may sign up (CLI-024). Kept out of
 * `ApiClient`, which is in every page's first download.
 */
@Injectable({ providedIn: 'root' })
export class TrainApi {
  private readonly http = inject(HttpClient);

  status(): Observable<TrainSignUp> {
    return this.http.get<TraineeSignUpStatusView>(SIGN_UP).pipe(map(toTrainSignUp));
  }

  register(request: RegisterTraineeRequest): Observable<TraineeRegistrationResponse> {
    return this.http.post<TraineeRegistrationResponse>(SIGN_UP, request);
  }
}
