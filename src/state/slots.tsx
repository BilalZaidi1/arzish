// Places where the hosted web edition adds its own controls to the shared app (account menu,
// notification bell, banners, the performance card). Empty in the artifact edition.
import React, { createContext, useContext } from 'react';

export interface Slots {
  /** Right end of the top bar. */
  topbar?: React.ReactNode;
  /** Above the screen content. */
  banner?: React.ReactNode;
  /** Top of the Overview screen. */
  overview?: React.ReactNode;
}

export const SlotsContext = createContext<Slots>({});

export function useSlots(): Slots {
  return useContext(SlotsContext);
}
