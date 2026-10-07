/** The coach's Nutrition pages, linked under each page's heading; the sidebar opens the first. */
export const NUTRITION_SECTIONS: readonly { label: string; link: string }[] = [
  { label: $localize`Meal plans`, link: '/nutrition/plans' },
  { label: $localize`Recipes`, link: '/nutrition/recipes' },
  { label: $localize`Foods`, link: '/nutrition/foods' },
];
