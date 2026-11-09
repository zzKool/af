import { create } from "zustand";

// F170: the expenses pages dock one panel at a time — a row's details or the new-expense form. The title row's
// *New expense* and the list are siblings on the page, so the choice lives here: opening the form closes the row,
// picking a row closes the form.
type ExpenseDockStore = {
  /** the new-expense form is open in the dock */
  creating: boolean;
  setCreating: (creating: boolean) => void;
};

export const useExpenseDockStore = create<ExpenseDockStore>((set) => ({
  creating: false,
  setCreating: (creating) => set({ creating }),
}));
