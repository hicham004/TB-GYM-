import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  ChangeProductOfferPriceRequest,
  CoachingProductView,
  CreateCoachingProductRequest,
  CreateProductOfferRequest,
  ProductCatalog,
  UpdateCoachingProductRequest,
} from '../../core/api/generated';

/**
 * Plans you sell (C8, R5.1a): the catalog with the caller's clients on each plan (SUB-015), and the
 * writes behind the page's sheets. Kept out of `ApiClient`, like `MealPlanApi`, so it loads only
 * with this page.
 */
@Injectable({ providedIn: 'root' })
export class ProductsApi {
  private readonly http = inject(HttpClient);

  getCatalog(): Observable<ProductCatalog> {
    return this.http.get<ProductCatalog>('/api/commercial/products');
  }

  createProduct(request: CreateCoachingProductRequest): Observable<CoachingProductView> {
    return this.http.post<CoachingProductView>('/api/commercial/products', request);
  }

  /** Name, description and whether it is sold; the version guards against a change made since. */
  updateProduct(
    productId: string,
    request: UpdateCoachingProductRequest,
  ): Observable<CoachingProductView> {
    return this.http.put<CoachingProductView>(`/api/commercial/products/${productId}`, request);
  }

  addOffer(productId: string, request: CreateProductOfferRequest): Observable<CoachingProductView> {
    return this.http.post<CoachingProductView>(
      `/api/commercial/products/${productId}/offers`,
      request,
    );
  }

  setOfferAvailability(
    offerId: string,
    isActive: boolean,
    version: number,
  ): Observable<CoachingProductView> {
    return this.http.put<CoachingProductView>(`/api/commercial/offers/${offerId}/availability`, {
      isActive,
      version,
    });
  }

  /** Retires the option and adds its replacement at the new price, atomically (SUB-002). */
  changePrice(
    offerId: string,
    request: ChangeProductOfferPriceRequest,
  ): Observable<CoachingProductView> {
    return this.http.post<CoachingProductView>(
      `/api/commercial/offers/${offerId}/price-changes`,
      request,
    );
  }
}
