import utils from '@bigcommerce/stencil-utils';
import ProductDetailsBase from './product-details-base';
import 'foundation-sites/js/foundation/foundation';
import 'foundation-sites/js/foundation/foundation.reveal';
import ImageGallery from '../product/image-gallery';
import modalFactory, { alertModal, showAlertModal, ModalEvents } from '../global/modal';
import { isEmpty, isPlainObject } from 'lodash';
import nod from './nod';
import { announceInputErrorMessage } from './utils/form-utils';
import forms from './models/forms';
import { normalizeFormData } from './utils/api';
import { isBrowserIE, convertIntoArray } from './utils/ie-helpers';
import bannerUtils from './utils/banner-utils';
import currencySelector from '../global/currency-selector';
import Swal from 'sweetalert2';

export default class ProductDetails extends ProductDetailsBase {
    constructor($scope, context, productAttributesData = {}) {
        super($scope, context);

        this.context = context;
        this.isCartPage = context.template === 'pages/cart';
        this.$overlay = $('[data-cart-item-add] .loadingOverlay');
        this.imageGallery = new ImageGallery($('[data-image-gallery]', this.$scope));
        this.imageGallery.init();
        this.listenQuantityChange();
        this.listenQuantityChangeStickyATC($('#halo_sticky_addToCart'));
        this.$swatchOptionMessage = $('.swatch-option-message');
        this.swatchInitMessageStorage = {};
        this.swatchGroupIdList = $('[id^="swatchGroup"]').map((_, group) => $(group).attr('id'));
        this.storeInitMessagesForSwatches();
        this.updateDateSelector();

        const $form = $('form[data-cart-item-add]', $scope);

        if ($form[0].checkValidity()) {
            this.updateProductDetailsData();
        } else {
            this.toggleWalletButtonsVisibility(false);
        }

        this.addToCartValidator = nod({
            submit: $form.find('input#form-action-addToCart'),
            tap: announceInputErrorMessage,
        });

        const $productOptionsElement = $('[data-product-option-change]', $form);
        const $productSwatchGroup = $('[id*="attribute_swatch"]', $form);
        const $productSwatchLabels = $('.form-option-swatch', $form);
        const placeSwatchLabelImage = (_, label) => {
            const $optionImage = $('.form-option-expanded', $(label));
            const optionImageWidth = $optionImage.outerWidth();
            const extendedOptionImageOffsetLeft = 55;
            const { right } = label.getBoundingClientRect();
            const emptySpaceToScreenRightBorder = window.screen.width - right;
            const shiftValue = optionImageWidth - emptySpaceToScreenRightBorder;

            if (emptySpaceToScreenRightBorder < (optionImageWidth + extendedOptionImageOffsetLeft)) {
                $optionImage.css('left', `${shiftValue > 0 ? -shiftValue : shiftValue}px`);
            }
        };

        $(window).on('load', () => {
            this.registerAddToCartValidation();
            $.each($productSwatchLabels, placeSwatchLabelImage);
        });

        if (context.showSwatchNames) {
            this.$swatchOptionMessage.removeClass('u-hidden');

            $productSwatchGroup.on('change', ({ target }) => {
                const swatchGroupElement = target.parentNode.parentNode;

                this.showSwatchNameOnOption($(target), $(swatchGroupElement));
            });

            $.each($productSwatchGroup, (_, element) => {
                const swatchGroupElement = element.parentNode.parentNode;

                if ($(element).is(':checked')) this.showSwatchNameOnOption($(element), $(swatchGroupElement));
            });
        }

        $productOptionsElement.on('change', event => {
            this.productOptionsChanged(event);
            this.setProductVariant();
        });

        if (!$productOptionsElement.length) {
            const simpleProductId = $('[name="product_id"]', $form).val();
            utils.api.productAttributes.optionChange(simpleProductId, $form.serialize(), (err, response) => {
                if (err || !response || !response.data) return;
                this.updateBackorderContext(response.data);
                const vm = this.getViewModel(this.$scope);
                const qty = parseInt(vm.quantity.$input.val(), 10) || 0;
                this.updateQtyBackorderedMessage(qty, vm);
                this.updateBackorderMessage(vm);
            });
        }

        $form.on('submit', event => {
            event.preventDefault();
            this.addToCartValidator.performCheck();

            if (this.addToCartValidator.areAll('valid')) {
                this.addProductToCart(event, $form[0]);
            }
        });

        // add to cart 2
        const $form2 = $('.mm-product form[data-cart-item-add-2]');
        const $productOptionsElement2 = $('[data-product-option-change-2]', $form2);

        $productOptionsElement2.on('change', event => {
            this.productOptionsChanged2(event);
            this.setProductVariant();
            this.setProductVariant2();
        });
        $form2.on('submit', event => {
            event.preventDefault();
            this.addToCartValidator.performCheck();
            if (this.addToCartValidator.areAll('valid')) {
                this.addProductToCart(event, $form2[0]);
            }
        });

        // Custom PickList
        $('#form-action-picklist').on("click", (event) => {
            event.preventDefault();
            this.handleAddPickListOptions().then((response) => {
                const listItemAddedHtml = response.map((item) => {
                    return `
                    <div class="productView-item">
                        <figure class="productView-image">
                            <div class="productView-img-container">
                                <img src="${item.thumbnail}" alt="">
                            </div>
                        </figure>
                        <div class="productView-details">
                            <h2 class="productView-title">
                                ${item.name}
                            </h2>
                            <div class="productView-brand">
                                ${item.brand}
                            </div>
                            <div class="productView-price">
                                ${item.quantity} &times; ${item.priceFormatted}
                            </div>
                        </div>
                    </div>
                `;
                });

                // Open preview modal and update content
                if (this.previewModal) {
                    this.previewModal.open();

                    if (window.ApplePaySession) {
                        this.previewModal.$modal.addClass('apple-pay-supported');
                    }

                    this.updateCartContent(this.previewModal, response[0].id, () => {
                        $('.previewCart-pl-layout .productView').html(listItemAddedHtml);
                    });
                } else {
                    this.$overlay.show();
                    // if no modal, redirect to the cart page
                    this.redirectTo(response.data.cart_item.cart_url || this.context.urls.cart);
                }
            }).catch((response) => {
                Swal.fire({
                    icon: 'warning',
                    title: 'Product Selection Required',
                    text: 'Please select a product before proceeding.',
                    confirmButtonText: 'Got it!'
                });
            });
        });

        this.updateProductAttributes(productAttributesData);

        if (productAttributesData
            && typeof productAttributesData === 'object'
            && Object.keys(productAttributesData).length > 0) {
            this.updateView(productAttributesData, null);
        } else {
            // eslint-disable-next-line no-console
            console.warn('BCData.product_attributes is empty on product initialization');
        }

        bannerUtils.dispatchProductBannerEvent(productAttributesData);

        $productOptionsElement.show();

        this.previewModal = modalFactory('#previewModal')[0];
    }

    registerAddToCartValidation() {
        this.addToCartValidator.add([{
            selector: '[data-quantity-change] > .form-input--incrementTotal',
            validate: (cb, val) => {
                const result = forms.numbersOnly(val);
                cb(result);
            },
            errorMessage: this.context.productQuantityErrorMessage,
        }]);

        return this.addToCartValidator;
    }

    storeInitMessagesForSwatches() {
        if (this.swatchGroupIdList.length && isEmpty(this.swatchInitMessageStorage)) {
            this.swatchGroupIdList.each((_, swatchGroupId) => {
                if (!this.swatchInitMessageStorage[swatchGroupId]) {
                    this.swatchInitMessageStorage[swatchGroupId] = $(`#${swatchGroupId} ~ .swatch-option-message`).text().trim();
                }
            });
        }
    }

    setProductVariant() {
        const unsatisfiedRequiredFields = [];
        const options = [];

        $.each($('[data-product-attribute]'), (index, value) => {
            const optionLabel = value.children[0].innerText;
            const optionTitle = optionLabel.split(':')[0].trim();
            const required = optionLabel.toLowerCase().includes('required');
            const type = value.getAttribute('data-product-attribute');

            if ((type === 'input-file' || type === 'input-text' || type === 'input-number') && value.querySelector('input').value === '' && required) {
                unsatisfiedRequiredFields.push(value);
            }

            if (type === 'textarea' && value.querySelector('textarea').value === '' && required) {
                unsatisfiedRequiredFields.push(value);
            }

            if (type === 'date') {
                const isSatisfied = Array.from(value.querySelectorAll('select')).every((select) => select.selectedIndex !== 0);

                if (isSatisfied) {
                    const dateString = Array.from(value.querySelectorAll('select')).map((x) => x.value).join('-');
                    options.push(`${optionTitle}:${dateString}`);

                    return;
                }

                if (required) {
                    unsatisfiedRequiredFields.push(value);
                }
            }

            if (type === 'set-select') {
                const select = value.querySelector('select');
                const selectedIndex = select.selectedIndex;

                if (selectedIndex !== 0) {
                    options.push(`${optionTitle}:${select.options[selectedIndex].innerText}`);

                    return;
                }

                if (required) {
                    unsatisfiedRequiredFields.push(value);
                }
            }

            if (type === 'set-rectangle' || type === 'set-radio' || type === 'swatch' || type === 'input-checkbox' || type === 'product-list') {
                const checked = value.querySelector(':checked');
                if (checked) {
                    const getSelectedOptionLabel = () => {
                        const productVariantslist = convertIntoArray(value.children);
                        const matchLabelForCheckedInput = inpt => inpt.dataset.productAttributeValue === checked.value;
                        return productVariantslist.filter(matchLabelForCheckedInput)[0];
                    };
                    if (type === 'set-rectangle' || type === 'set-radio' || type === 'product-list') {
                        const label = isBrowserIE ? getSelectedOptionLabel().innerText.trim() : checked.labels[0]?.innerText;
                        if (label) {
                            options.push(`${optionTitle}:${label}`);
                        }
                    }

                    if (type === 'swatch') {
                        const label = isBrowserIE ? getSelectedOptionLabel().children[0] : checked.labels[0].children[0];
                        if (label) {
                            options.push(`${optionTitle}:${label.title}`);
                        }
                    }

                    if (type === 'input-checkbox') {
                        options.push(`${optionTitle}:Yes`);
                    }

                    return;
                }

                if (type === 'input-checkbox') {
                    options.push(`${optionTitle}:No`);
                }

                if (required) {
                    unsatisfiedRequiredFields.push(value);
                }
            }
        });

        let productVariant = unsatisfiedRequiredFields.length === 0 ? options.sort().join(', ') : 'unsatisfied';
        const view = $('.productView');

        if (productVariant) {
            productVariant = productVariant === 'unsatisfied' ? '' : productVariant;
            if (view.attr('data-event-type')) {
                view.attr('data-product-variant', productVariant);
            } else {
                const productName = view.find('.productView-title')[0].innerText.replace(/"/g, '\\$&');
                const card = $(`[data-name="${productName}"]`);
                card.attr('data-product-variant', productVariant);
            }
        }
    }

    setProductVariant2() {
        const unsatisfiedRequiredFields = [];
        const options = [];

        $.each($('[data-product-option-change-2] [data-product-attribute]'), (index, value) => {
            const optionLabel = value.children[0].innerText;
            const optionTitle = optionLabel.split(':')[0].trim();
            const required = optionLabel.toLowerCase().includes('required');
            const type = value.getAttribute('data-product-attribute');

            if ((type === 'input-file' || type === 'input-text' || type === 'input-number') && value.querySelector('input').value === '' && required) {
                unsatisfiedRequiredFields.push(value);
            }

            if (type === 'textarea' && value.querySelector('textarea').value === '' && required) {
                unsatisfiedRequiredFields.push(value);
            }

            if (type === 'date') {
                const isSatisfied = Array.from(value.querySelectorAll('select')).every((select) => select.selectedIndex !== 0);

                if (isSatisfied) {
                    const dateString = Array.from(value.querySelectorAll('select')).map((x) => x.value).join('-');
                    options.push(`${optionTitle}:${dateString}`);

                    return;
                }

                if (required) {
                    unsatisfiedRequiredFields.push(value);
                }
            }

            if (type === 'set-select') {
                const select = value.querySelector('select');
                const selectedIndex = select.selectedIndex;

                if (selectedIndex !== 0) {
                    options.push(`${optionTitle}:${select.options[selectedIndex].innerText}`);
                    $(value.children[0]).find('[data-option-value]').text(select.options[selectedIndex].innerText);

                    return;
                }

                if (required) {
                    unsatisfiedRequiredFields.push(value);
                }
            }

            if (type === 'set-rectangle' || type === 'set-radio' || type === 'swatch' || type === 'input-checkbox' || type === 'product-list') {
                const checked = value.querySelector(':checked');
                if (checked) {
                    const getSelectedOptionLabel = () => {
                        const productVariantslist = convertIntoArray(value.children);
                        const matchLabelForCheckedInput = inpt => inpt.dataset.productAttributeValue === checked.value;
                        return productVariantslist.filter(matchLabelForCheckedInput)[0];
                    };
                    if (type === 'set-rectangle' || type === 'set-radio' || type === 'product-list') {
                        const label = isBrowserIE ? getSelectedOptionLabel().innerText.trim() : checked.labels[0].innerText;
                        if (label) {
                            options.push(`${optionTitle}:${label}`);
                            $(value.children[0]).find('[data-option-value]').text(label);
                        }
                    }

                    if (type === 'swatch') {
                        const label = isBrowserIE ? getSelectedOptionLabel().children[0] : checked.labels[0].children[0];
                        if (label) {
                            options.push(`${optionTitle}:${label.title}`);
                            $(value.children[0]).find('[data-option-value]').text(label.title);
                        }
                    }

                    if (type === 'input-checkbox') {
                        options.push(`${optionTitle}:Yes`);
                    }

                    return;
                }

                if (type === 'input-checkbox') {
                    options.push(`${optionTitle}:No`);
                }

                if (required) {
                    unsatisfiedRequiredFields.push(value);
                }
            }
        });

        let productVariant = unsatisfiedRequiredFields.length === 0 ? options.sort().join(', ') : undefined;
        const view = $('.productView');

        if (productVariant) {
            productVariant = productVariant === 'unsatisfied' ? '' : productVariant;
            if (view.attr('data-event-type')) {
                view.attr('data-product-variant', productVariant);
            } else {
                const productName = view.find('.productView-title')[0] ? view.find('.productView-title')[0].innerText.replace(/"/g, '\\$&') : this.$scope.find('.productView-title').text().replace(/"/g, '\\$&');
                const card = $(`[data-name="${productName}"]`);
                card.attr('data-product-variant', productVariant);
            }
        }
        let productVariant2 = unsatisfiedRequiredFields.length === 0 ? options.sort() : undefined;

        if (productVariant2) {
            var listVariant = '';
            $.each(productVariant2, (index, value) => {
                if (index > 0) {
                    listVariant += ' / ' + productVariant2[index].toString().split(':').pop();
                } else if (index == 0) {
                    listVariant += productVariant2[index].toString().split(':').pop();
                }
            });

            this.$scope.find('.productView-notifyMe').attr('data-product-variant', listVariant);
        }
    }

    /**
     * Checks if the current window is being run inside an iframe
     * @returns {boolean}
     */
    isRunningInIframe() {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    }

    /**
     *
     * Handle product options changes
     *
     */
    productOptionsChanged(event) {
        const $changedOption = $(event.target);
        const $form = $changedOption.parents('form');
        const productId = $('[name="product_id"]', $form).val();

        // Do not trigger an ajax request if it's a file or if the browser doesn't support FormData
        if ($changedOption.attr('type') === 'file' || window.FormData === undefined) {
            return;
        }

        if (this.context.themeSettings.enable_mul_quantity_picklist) {
            const isRequired = $('.muiltiple-picklist-wrapper[required]').length > 0;
            if (isRequired) {
                if ($changedOption.is(":checked")) {
                    $('.muiltiple-picklist-wrapper[required] .productOptions-list-item--none').val($changedOption.val()).trigger('click');
                }else {
                    $('.muiltiple-picklist-wrapper[required] .productOptions-list-item--none').val("").trigger('click');
                }
            }
        }

        utils.api.productAttributes.optionChange(productId, $form.serialize(), 'products/bulk-discount-rates', (err, response) => {
            const productAttributesData = response.data || {};
            const productAttributesContent = response.content || {};
            this.updateProductAttributes(productAttributesData);
            this.updateView(productAttributesData, productAttributesContent);
            this.updateProductDetailsData();
            bannerUtils.dispatchProductBannerEvent(productAttributesData);

            if (!this.checkIsQuickViewChild($form)) {
                const $context = $form.parents('.productView').find('.productView-info');
                modalFactory('[data-reveal]', { $context });
            }

            document.dispatchEvent(new CustomEvent('onProductOptionsChanged', {
                bubbles: true,
                detail: {
                    content: productAttributesData,
                    data: productAttributesContent,
                },
            }));
        }, { baseUrl: this.context.secureBaseUrl });
    }

    productOptionsChanged2(event) {
        const $changedOption = $(event.target);
        const $form = $changedOption.parents('form');
        const productId = $('[name="product_id"]', $form).val();

        // Do not trigger an ajax request if it's a file or if the browser doesn't support FormData
        if ($changedOption.attr('type') === 'file' || window.FormData === undefined) {
            return;
        }
        utils.api.productAttributes.optionChange(productId, $form.serialize(), 'products/bulk-discount-rates', (err, response) => {
            const productAttributesData = response.data || {};
            const productAttributesContent = response.content || {};
            this.updateProductAttributes(productAttributesData);
            this.updateView(productAttributesData, productAttributesContent);
            bannerUtils.dispatchProductBannerEvent(productAttributesData);

            if (!this.checkIsQuickViewChild($form)) {
                const $context = $form.parents('.productView').find('.productView-info');
                modalFactory('[data-reveal]', { $context });
            }

            document.dispatchEvent(new CustomEvent('onProductOptionsChanged', {
                bubbles: true,
                detail: {
                    content: productAttributesData,
                    data: productAttributesContent,
                },
            }));

            $.each(productAttributesData.selected_attributes, function (i, el) {
                $.each($('[data-product-option-change-2] [data-product-attribute] input'), function (i) {
                    var op = $(this).attr('value');
                    if (el == op) {
                        $(this).prop('checked', true);

                        if ($(this).next().hasClass('form-option-swatch')) {
                            var opTitle = $(this).next().children('.form-option-variant').attr('title');

                            $(this).parents('.item-wrap').find('.color-name').text(` - ${opTitle}`);
                        }
                    }
                })
            });

            $.each($('[data-product-option-change-2] [data-product-attribute]'), function (i) {
                var el = $(this).find('.form-radio:checked').attr('value');
                $.each($('.productView-options [data-product-option-change] [data-product-attribute] input'), function (i) {
                    var op = $(this).attr('value');
                    if ($(this).next().hasClass('form-option-swatch')) {
                        var opTitle = $(this).next().children('.form-option-variant').attr('title');
                    } else if ($(this).next().children('.form-option-variant').length) {
                        var opTitle = $(this).next().children('.form-option-variant').text();
                    } else {
                        var opTitle = $(this).next('.form-label').text();
                    }

                    if (el == op) {
                        $(this).prop('checked', true);
                        $(this).parents('[data-product-attribute]').find('[data-option-value]').text(opTitle);
                    }
                })
            });

            var color = $('[data-product-option-change-2] [data-product-attribute="swatch"]').find('.form-radio:checked').next().find('> span').attr('title');
            $('#halo_sticky_addToCart .option-value .color-name').text(` - ${color}`);
        }, { baseUrl: this.context.secureBaseUrl });
    }

    /**
     * if this setting is enabled in Page Builder
     * show name for swatch option
     */
    showSwatchNameOnOption($swatch, $swatchGroup) {
        const swatchName = $swatch.attr('aria-label');
        const activeSwatchGroupId = $swatchGroup.attr('aria-labelledby');
        const $swatchOptionMessage = $(`#${activeSwatchGroupId} ~ .swatch-option-message`);

        $('[data-option-value]', $swatchGroup).text(swatchName);
        $swatchOptionMessage.text(`${this.swatchInitMessageStorage[activeSwatchGroupId]} ${swatchName}`);
        this.setLiveRegionAttributes($swatchOptionMessage, 'status', 'assertive');
    }

    setLiveRegionAttributes($element, roleType, ariaLiveStatus) {
        $element.attr({
            role: roleType,
            'aria-live': ariaLiveStatus,
        });
    }

    checkIsQuickViewChild($element) {
        return !!$element.parents('.quickView').length;
    }

    showProductImage(image) {
        if (isPlainObject(image)) {
            const zoomImageUrl = utils.tools.imageSrcset.getSrcset(
                image.data,
                { '1x': this.context.zoomSize },
                /*
                    Should match zoom size used for data-zoom-image in
                    components/products/product-view.html

                    Note that this will only be used as a fallback image for browsers that do not support srcset

                    Also note that getSrcset returns a simple src string when exactly one size is provided
                */
            );

            const mainImageUrl = utils.tools.imageSrcset.getSrcset(
                image.data,
                { '1x': this.context.productSize },
                /*
                    Should match fallback image size used for the main product image in
                    components/products/product-view.html

                    Note that this will only be used as a fallback image for browsers that do not support srcset

                    Also note that getSrcset returns a simple src string when exactly one size is provided
                */
            );

            const mainImageSrcset = utils.tools.imageSrcset.getSrcset(image.data);

            this.imageGallery.setAlternateImage({
                mainImageUrl,
                zoomImageUrl,
                mainImageSrcset,
            });
        } else {
            this.imageGallery.restoreImage();
        }
    }

    /**
     *
     * Handle action when the shopper clicks on + / - for quantity
     *
     */
    listenQuantityChange() {
        this.$scope.on('click', '[data-quantity-change] button', event => {
            event.preventDefault();
            const $target = $(event.currentTarget);
            const viewModel = this.getViewModel(this.$scope);
            const $input = viewModel.quantity.$input;
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
            viewModel.quantity.$input.val(qty);
            // update text
            viewModel.quantity.$text.text(qty);
            // perform validation after updating product quantity
            this.addToCartValidator.performCheck();

            this.updateProductDetailsData();
            this.updateQtyBackorderedMessage(qty, viewModel);
            this.updateBackorderMessage(viewModel);
        });

        // Prevent triggering quantity change when pressing enter
        this.$scope.on('keypress', '.form-input--incrementTotal', event => {
            // If the browser supports event.which, then use event.which, otherwise use event.keyCode
            const x = event.which || event.keyCode;
            if (x === 13) {
                // Prevent default
                event.preventDefault();
            }
        });

        this.$scope.on('keyup', '.form-input--incrementTotal', () => {
            const viewModel = this.getViewModel(this.$scope);
            const qty = parseInt(viewModel.quantity.$input.val(), 10) || 0;
            this.updateProductDetailsData();
            this.updateQtyBackorderedMessage(qty, viewModel);
            this.updateBackorderMessage(viewModel);
        });
    }

    listenQuantityChangeStickyATC($scope) {
        $scope.on('click', '[data-quantity-change-2] button', event => {
            event.preventDefault();
            const $target = $(event.currentTarget);
            const viewModel = this.getViewModel($scope);
            const $input = viewModel.quantity.$input;
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
            viewModel.quantity.$input.val(qty);
            // update text
            viewModel.quantity.$text.text(qty);
            // perform validation after updating product quantity
            this.addToCartValidator.performCheck();
        });

        // Prevent triggering quantity change when pressing enter
        $scope.on('keypress', '#halo_sticky_addToCart .form-input--incrementTotal', event => {
            // If the browser supports event.which, then use event.which, otherwise use event.keyCode
            const x = event.which || event.keyCode;
            if (x === 13) {
                // Prevent default
                event.preventDefault();
            }
        });
    }

    /**
     *
     * Add a product to cart
     *
     */
    addProductToCart(event, form) {
        const $addToCartBtn = $('#form-action-addToCart', $(event.target));
        const originalBtnVal = $addToCartBtn.val();
        const waitMessage = $addToCartBtn.data('waitMessage');

        // Do not do AJAX if browser doesn't support FormData
        if (window.FormData === undefined) {
            return;
        }

        // Prevent default
        event.preventDefault();

        $addToCartBtn
            .val(waitMessage)
            .prop('disabled', true);

        this.$overlay.show();
        const pickListInputEles = $('.productView-details .productOptions-list .productOptions-list-item .form-radio:checked');

        if (this.context.themeSettings.enable_mul_quantity_picklist && pickListInputEles.length > 0) {
            this.handleAddPickListOptions()
                .then((response) => {
                    const listItemAddedHtml = response.map((item) => {
                        return `
                            <div class="productView-item">
                                <figure class="productView-image">
                                    <div class="productView-img-container">
                                        <img src="${item.thumbnail}" alt="">
                                    </div>
                                </figure>
                                <div class="productView-details">
                                    <h2 class="productView-title">
                                        ${item.name}
                                    </h2>
                                    <div class="productView-brand">
                                        ${item.brand}
                                    </div>
                                    <div class="productView-price">
                                        ${item.quantity} &times; ${item.priceFormatted}
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                    // Add item to cart
                    utils.api.cart.itemAdd(normalizeFormData(new FormData(form)), (err, response) => {
                        currencySelector(response.data.cart_id);
                        const errorMessage = err || response.data.error;

                        $addToCartBtn
                            .val(originalBtnVal)
                            .prop('disabled', false);

                        this.$overlay.hide();

                        // Guard statement
                        if (errorMessage) {
                            // Strip the HTML from the error message
                            const tmp = document.createElement('DIV');
                            tmp.innerHTML = errorMessage;

                            if (!this.checkIsQuickViewChild($addToCartBtn)) {
                                alertModal().$preModalFocusedEl = $addToCartBtn;
                            }

                            return showAlertModal(tmp.textContent || tmp.innerText);
                        }

                        // Open preview modal and update content
                        if (this.previewModal) {
                            this.previewModal.open();

                            if (window.ApplePaySession) {
                                this.previewModal.$modal.addClass('apple-pay-supported');
                            }

                            if (!this.checkIsQuickViewChild($addToCartBtn)) {
                                this.previewModal.$preModalFocusedEl = $addToCartBtn;
                            }

                            this.updateCartContent(this.previewModal, response.data.cart_item.id, () => {
                                $('.previewCart-pl-layout .productView').append(listItemAddedHtml);
                            });
                        } else {
                            this.$overlay.show();
                            // if no modal, redirect to the cart page
                            this.redirectTo(response.data.cart_item.cart_url || this.context.urls.cart);
                        }
                    }, { baseUrl: this.context.secureBaseUrl });
                })
        } else {
            // Add item to cart
            utils.api.cart.itemAdd(normalizeFormData(new FormData(form)), (err, response) => {
                currencySelector(response.data.cart_id);
                const errorMessage = err || response.data.error;

                $addToCartBtn
                    .val(originalBtnVal)
                    .prop('disabled', false);

                this.$overlay.hide();

                // Guard statement
                if (errorMessage) {
                    // Strip the HTML from the error message
                    const tmp = document.createElement('DIV');
                    tmp.innerHTML = errorMessage;

                    if (!this.checkIsQuickViewChild($addToCartBtn)) {
                        alertModal().$preModalFocusedEl = $addToCartBtn;
                    }

                    return showAlertModal(tmp.textContent || tmp.innerText);
                }

                // Open preview modal and update content
                if (this.previewModal) {
                    this.previewModal.open();

                    if (window.ApplePaySession) {
                        this.previewModal.$modal.addClass('apple-pay-supported');
                    }

                    if (!this.checkIsQuickViewChild($addToCartBtn)) {
                        this.previewModal.$preModalFocusedEl = $addToCartBtn;
                    }

                    this.updateCartContent(this.previewModal, response.data.cart_item.id, () => {
                        $('.previewCart-pl-layout .productView').append(listItemAddedHtml);
                    });
                    } else {
                    this.$overlay.show();
                    // if no modal, redirect to the cart page
                    this.redirectTo(response.data.cart_item.cart_url || this.context.urls.cart);
                }
            }, { baseUrl: this.context.secureBaseUrl });
        }

        this.setLiveRegionAttributes($addToCartBtn.next(), 'status', 'polite');
    }

    /**
     * Get cart contents
     *
     * @param {String} cartItemId
     * @param {Function} onComplete
     */
    getCartContent(cartItemId, onComplete) {
        const isEnablePickList = this.context.themeSettings.enable_mul_quantity_picklist;
        const options = {
            template: isEnablePickList ? 'cart/preview-pick-list' : 'cart/preview',
            params: {
                suggest: cartItemId,
            },
            config: {
                cart: {
                    suggestions: {
                        limit: 4,
                    },
                },
            },
            baseUrl: this.context.secureBaseUrl,
        };

        utils.api.cart.getContent(options, onComplete);
    }

    /**
     * Redirect to url
     *
     * @param {String} url
     */
    redirectTo(url) {
        if (this.isRunningInIframe() && !window.iframeSdk) {
            window.top.location = url;
        } else {
            window.location = url;
        }
    }

    /**
     * Update cart content
     *
     * @param {Modal} modal
     * @param {String} cartItemId
     * @param {Function} onComplete
     */
    updateCartContent(modal, cartItemId, onComplete) {
        this.getCartContent(cartItemId, (err, response) => {
            if (err) {
                return;
            }
            modal.updateContent(response);

            // Update cart counter
            const $body = $('body');
            const $cartQuantity = $('[data-cart-quantity]', modal.$content);
            const $cartCounter = $('.navUser-action .cart-count');
            const quantity = $cartQuantity.data('cartQuantity') || 0;
            const $promotionBanner = $('[data-promotion-banner]');
            const $backToShopppingBtn = $('.previewCartCheckout > [data-reveal-close]');
            const $modalCloseBtn = $('#previewModal > .modal-close');
            const bannerUpdateHandler = () => {
                const $productContainer = $('#main-content > .container');

                $productContainer.append('<div class="loadingOverlay pdp-update"></div>');
                $('.loadingOverlay.pdp-update', $productContainer).show();
                window.location.reload();
            };

            $cartCounter.addClass('cart-count--positive');
            $body.trigger('cart-quantity-update', quantity);

            if (onComplete) {
                onComplete(response);
            }

            if (this.isCartPage) {
                modal.$modal.one(ModalEvents.closed, () => {
                    // Close quick search overlay if it's open (ESC and backdrop click don't close it automatically)
                    const $searchContainer = $('#quickSearch');
                    if ($searchContainer.hasClass('is-open')) {
                        $searchContainer.removeClass('is-open').attr('aria-hidden', 'true');
                    }
                    bannerUpdateHandler();
                });
            } else if ($promotionBanner.length && $backToShopppingBtn.length) {
                $backToShopppingBtn.on('click', bannerUpdateHandler);
                $modalCloseBtn.on('click', bannerUpdateHandler);
            }
        });
    }

    /**
     * Hide or mark as unavailable out of stock attributes if enabled
     * @param  {Object} data Product attribute data
     */
    updateProductAttributes(data) {
        super.updateProductAttributes(data);
        this.showProductImage(data.image);
    }

    updateProductDetailsData() {
        const $form = $('form[data-cart-item-add]');
        const formDataItems = $form.serializeArray();

        const productDetails = {};

        for (const formDataItem of formDataItems) {
            const { name, value } = formDataItem;

            if (name === 'product_id') {
                productDetails.productId = Number(value);
            }

            if (name === 'qty[]') {
                productDetails.quantity = Number(value);
            }

            if (name.match(/attribute/)) {
                const productOption = {
                    optionId: Number(name.match(/\d+/g)[0]),
                    optionValue: value,
                };

                productDetails.optionSelections = productDetails?.optionSelections
                    ? [...productDetails.optionSelections, productOption]
                    : [productOption];
            }
        }

        document.dispatchEvent(new CustomEvent('onProductUpdate', {
            bubbles: true,
            detail: { productDetails },
        }));
    }

    handleAddPickListOptions() {
        return new Promise((resolve, reject) => {
            const pickListInputEles = $('.productView-details .productOptions-list .productOptions-list-item .form-radio:checked');
            const formDataArray = [];
            const itemsPlAdded = [];

            if (pickListInputEles.length === 0) {
                reject('Error: No picklist item selected');
                return;
            }

            pickListInputEles.each((index, pickListInputEle) => {
                const formData = new FormData();
                const pickListItemEle = $(pickListInputEle).closest('.productOptions-list-item');
                const inputQuantityEle = $('input[name="plqty[]"]', pickListItemEle);
                const productId = pickListItemEle.data('product-id');
                const quantityData = inputQuantityEle.val();

                formData.append("action", "add");
                formData.append("product_id", productId);
                formData.append("qty[]", quantityData);

                formDataArray.push(formData);
            });

            this.addToCart(formDataArray, 0, resolve, itemsPlAdded);
        });
    }

    addToCart(form, i, resolve, itemsPlAdded) {
        if (i > form.length - 1) {
            resolve(itemsPlAdded);
            return;
        }

        // Add item to cart
        utils.api.cart.itemAdd(form[i], (err, response) => {
            const errorMessage = err || response.data.error;

            const data = new Promise((resolve, reject) => {
                utils.api.cart.getCart({ includeSuggestions: true }, (err, response) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(response);
                });
            });

            if (errorMessage) {
                // Strip the HTML from the error message
                const tmp = document.createElement('DIV');
                tmp.innerHTML = errorMessage;
                alert(tmp.textContent || tmp.innerText);
                return;
            }

            data.then((res) => {
                var listItem = res.lineItems.physicalItems;
                const currentData = listItem.filter((item) => {
                    return item.id == response.data.cart_item.id;
                });

                // Guard statement
                const priceFormatted = $(`.productView .productOptions-list-item[data-product-id="${response.data.cart_item.product_id}"] .price-value`).text();

                itemsPlAdded.push({
                    ...response.data.cart_item,
                    ...currentData[0],
                    priceFormatted: priceFormatted
                });

                ++i;
                this.addToCart(form, i, resolve, itemsPlAdded);
            });
        }, { baseUrl: this.context.secureBaseUrl });
    }

    updateDateSelector() {
        this.$scope.each((i, scope) => {
            function updateDays(dateOption) {
                const monthSelector = dateOption.querySelector('select[name$="[month]"]');
                const daySelector = dateOption.querySelector('select[name$="[day]"]');
                const yearSelector = dateOption.querySelector('select[name$="[year]"]');
                const month = parseInt(monthSelector.value, 10);
                const year = parseInt(yearSelector.value, 10);
                let daysInMonth;

                if (!Number.isNaN(month) && !Number.isNaN(year)) {
                    switch (month) {
                    case 2:
                        daysInMonth = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0) ? 29 : 28;
                        break;
                    case 4: case 6: case 9: case 11:
                        daysInMonth = 30;
                        break;
                    default:
                        daysInMonth = 31;
                    }

                    for (let day = 29; day <= 31; day++) {
                        const option = daySelector.querySelector(`option[value="${day}"]`);
                        if (day <= daysInMonth && !option) {
                            daySelector.options.add(new Option(day, day));
                        } else if (day > daysInMonth && option) {
                            option.remove();
                        }
                    }
                }
            }

            $(scope).on('change', (e) => {
                const dateOption = e.target && e.target.closest && e.target.closest('[data-product-attribute=date]');

                if (dateOption) {
                    updateDays(dateOption);
                }
            });

            scope.querySelectorAll('[data-product-attribute=date]').forEach(dateOption => {
                updateDays(dateOption);
            });
        });
    }
}
