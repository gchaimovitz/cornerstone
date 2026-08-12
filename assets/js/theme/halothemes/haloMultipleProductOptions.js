import utils from '@bigcommerce/stencil-utils';
import forms from '../common/models/forms';

export default function (context) {
  const token = context.token,
    curCode = $('.body').data('currency-code');
  const pickListItemEles = $('.productOptions-list .productOptions-list-item');
  let arrProdIds = [];

  pickListItemEles.each(function (index, element) {
    arrProdIds.push($(element).data('product-id'));
    const productViewEle = $('.productView');
    
    listenQuantityChange(element, productViewEle);
    listCheckboxes(element);
  });

  getProduct(arrProdIds).then(data => {
    const curDisplay = data.site.currency.display;
    const symbol = curDisplay.symbol,
      symbolPlacement = curDisplay.symbolPlacement.toLowerCase(),
      decimalToken = curDisplay.decimalToken,
      decimalPlaces = curDisplay.decimalPlaces,
      thousandsToken = curDisplay.thousandsToken;
    
    const products = data.site.products.edges;

    for (const item of products) {
      const productItem = item.product;
      const isInStock = productItem.inventory.isInStock;

      const priceFormatted = (symbolPlacement == "left" ? symbol : "") + (formatMoney(productItem.pricesWithoutTax.price.value, decimalPlaces, decimalToken, thousandsToken)) + (symbolPlacement != "left" ? symbol : "");
      $(`.productOptions-list-item[data-product-id="${productItem.entityId}"] .price-value`).html(priceFormatted);
      $(`.productOptions-list-item[data-product-id="${productItem.entityId}"] .pl-item-name`).attr('href', productItem.path);

      if (!isInStock) $(`.productOptions-list-item[data-product-id="${productItem.entityId}"]`).addClass('out-of-stock');
    }
    


  });
  
  function getProduct(arr) {
    return fetch('/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        query: `
              query MyQuery {
                  site {
                      products (entityIds: [`+ arr + `], first: 50) {
                        edges {
                          product: node {
                            ...ProductFields
                            }
                          }
                      }
                      currency (currencyCode: `+ curCode + `) {
                          display {
                              symbol
                              symbolPlacement
                              decimalToken
                              thousandsToken
                              decimalPlaces
                          }
                      }
                  }
              }
              fragment ProductFields on Product {
                  id
                  entityId
                  name
                  path
                  inventory {
                      isInStock
                      hasVariantInventory
                  }
                  defaultImage {
                      img250px: url(width: 250)
                      altText
                  }
                  pricesWithTax: prices(includeTax: true, currencyCode: `+ curCode + `) {
                      price {  
                          ...MoneyFields  
                      }  
                      basePrice {  
                          ...MoneyFields  
                      }  
                      salePrice {  
                          ...MoneyFields  
                      }  
                      retailPrice {  
                          ...MoneyFields  
                      }  
                      priceRange {  
                          min {  
                              ...MoneyFields  
                          }  
                          max {  
                              ...MoneyFields  
                          }  
                      }  
                  }  
                  pricesWithoutTax: prices(includeTax: false, currencyCode: `+ curCode + `) {  
                      price {  
                          ...MoneyFields  
                      }  
                      basePrice {  
                          ...MoneyFields  
                      }  
                      salePrice {  
                          ...MoneyFields  
                      }  
                      retailPrice {  
                          ...MoneyFields  
                      }  
                      priceRange {  
                          min {  
                              ...MoneyFields  
                          }  
                          max {  
                              ...MoneyFields  
                          }  
                      }  
                  }
              }
              fragment MoneyFields on Money {
                  value
                  currencyCode
              }
          `}),
    }).then(res => res.json())
      .then(res => res.data);
  }

  function formatMoney(n, c, d, t) {
    var c = isNaN(c = Math.abs(c)) ? 2 : c,
      d = d == undefined ? "." : d,
      t = t == undefined ? "," : t,
      s = n < 0 ? "-" : "",
      i = String(parseInt(n = Math.abs(Number(n) || 0).toFixed(c))),
      j = (j = i.length) > 3 ? j % 3 : 0;

    return s + (j ? i.substr(0, j) + t : "") + i.substr(j).replace(/(\d{3})(?=\d)/g, "$1" + t) + (c ? d + Math.abs(n - i).toFixed(c).slice(2) : "");
  }

  function listenQuantityChange(element, productViewEle) {
    $(element).on('click', '[data-picklist-change] button', event => {
      event.preventDefault();
      const $target = $(event.currentTarget);
      const currentItemProId = $target.closest('.productOptions-list-item').data('product-id');
      const $input = $(`.productOptions-list-item[data-product-id="${currentItemProId}"] [name=plqty\\[\\]]`);
      const quantityMin = parseInt($input.data('quantityMin'), 10);
      const quantityMax = parseInt($input.data('quantityMax'), 10);
      let qty = forms.numbersOnly($input.val()) ? parseInt($input.val(), 10) : quantityMin;
      // If action is incrementing
      if ($target.data('action') === 'inc') {
        qty = forms.validateIncreaseAgainstMaxBoundary(qty, quantityMax);
      } else if (qty > 1) {
        qty = forms.validateDecreaseAgainstMinBoundary(qty, quantityMin);
      }

      // update hidden input
      $input.val(qty);
    });
  }

  function listCheckboxes(element) {
    const checkboxEle = $('input.form-radio', $(element));
    $(checkboxEle).on('click', event => {
      const $target = $(event.currentTarget);
      const isChecked = $target.context.checked;
      const currentItemProId = $target.closest('.productOptions-list-item').data('product-id');
      const $input = $(`.productOptions-list-item[data-product-id="${currentItemProId}"] .form-radio`);
      if (isChecked) {
        $input.prop('checked', true);
        $input.change();
      } else {
        $input.prop('checked', false);
        $input.change();
      }
    });
  }
}

