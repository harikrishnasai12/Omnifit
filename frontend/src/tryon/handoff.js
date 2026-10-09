// A product chosen with "Try on" elsewhere in the app, or the pieces of an
// outfit chosen with "Try This Look", wait under this key (in this browser
// tab only) until the Try-On page picks them up.
export const TRYON_PRODUCT_KEY = "omnifit.tryon.product";

// `products`: one product, or a list (the first is tried on, the rest are
// there to pick from)
export const sendToTryOn = (products) => {
  try {
    sessionStorage.setItem(TRYON_PRODUCT_KEY, JSON.stringify(products));
  } catch {
    // Storage blocked: the Try-On page opens without a product
  }
};
