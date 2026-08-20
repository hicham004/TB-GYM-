import { Routes } from '@angular/router';

export const authRoutes: Routes = [
  {
    path: 'sign-in',
    title: $localize`Sign in | TB Gym`,
    loadComponent: () => import('./sign-in').then((module) => module.SignIn),
  },
  {
    path: 'register',
    title: $localize`Create coach account | TB Gym`,
    loadComponent: () => import('./register-coach').then((module) => module.RegisterCoach),
  },
  {
    path: 'forgot-password',
    title: $localize`Forgot password | TB Gym`,
    loadComponent: () => import('./forgot-password').then((module) => module.ForgotPassword),
  },
  {
    path: 'reset-password',
    title: $localize`Reset password | TB Gym`,
    loadComponent: () => import('./reset-password').then((module) => module.ResetPassword),
  },
  {
    path: 'confirm-email',
    title: $localize`Confirm email | TB Gym`,
    loadComponent: () => import('./confirm-email').then((module) => module.ConfirmEmail),
  },
  { path: '', pathMatch: 'full', redirectTo: 'sign-in' },
];
