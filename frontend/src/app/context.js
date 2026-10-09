import { createContext, useContext } from "react";

// Everything the app knows and can do, provided by OmniFitProvider
export const OmniFitContext = createContext(null);

export const useOmniFit = () => useContext(OmniFitContext);
