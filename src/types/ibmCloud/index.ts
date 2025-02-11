// types/ibmCloud/index.ts
export interface IBMCloudError extends Error {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: any;
}

export interface CatalogResponse {
    id: string;
    rev?: string;
    label: string;
    short_description?: string;
    catalog_icon_url?: string;
    tags?: string[];
    url?: string;
    crn?: string;
    offerings_url?: string;
    features?: any[];
    disabled?: boolean;
    created?: string;
    updated?: string;
}

export interface CatalogItem {
    id: string;
    label: string;
    shortDescription?: string;
    disabled?: boolean;
    isPublic: boolean;
}

export interface OfferingItem {
    id: string;
    name: string;
    label?: string;
    shortDescription?: string;
    kinds?: Kind[];
    created?: string;
    updated?: string;
    metadata?: Record<string, unknown>;
}

export interface Kind {
    id: string;
    format_kind?: string;
    format_kind_label?: string;
    install_kind?: string;
    install_kind_label?: string;
    target_kind?: string;
    target_kind_label?: string;
    versions?: OfferingVersion[];
    metadata?: Record<string, unknown>;
}

export interface OfferingVersion {
    id: string;
    version: string;
    flavor?: OfferingFlavor;
    created?: string;
    updated?: string;
    catalog_id?: string;
    offering_id?: string;
    kind_id?: string;
    tags?: string[];
    tgz_url?: string;
    configuration?: Configuration[];
    outputs?: Output[];
}

export interface Output {
    key: string;
    description?: string;
}

export interface Configuration {
    key: string;
    type: string;
    description?: string;
    default_value?: string | number | boolean;
    required?: boolean;
}

export interface OfferingFlavor {
    name: string;
    label: string;
    label_i18n?: Record<string, string>;
    index?: number;
    description?: string;
    displayName?: string;
}
