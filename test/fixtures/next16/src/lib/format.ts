export const formatPrice = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
export const formatNumber = (value: number) => new Intl.NumberFormat('fr-FR').format(value);
export const formatDate = (date: Date) => new Intl.DateTimeFormat('fr-FR').format(date);
