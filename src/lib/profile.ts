/** hosted = multi-tenant deployed profile (`SIFT_PROFILE=hosted`); local = single-user default. */
export const isHosted = () => process.env.SIFT_PROFILE === "hosted";
